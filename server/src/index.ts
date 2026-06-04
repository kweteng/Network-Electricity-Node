import express from 'express';
import cors from 'cors';
import { initDb } from './db';
import pool from './db';
import { runCleanup } from './cleanup';

const snmp = require('net-snmp');
const app = express();
const port = process.env.PORT || 3001;
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const logIngest = process.env.LOG_INGEST === 'true';

type MetricRow = {
  site_id: number;
  device_type: string;
  index: number;
  timestamp: string;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  soh: number | null;
  ac_voltage: number | null;
  ac_v_l1: number | null;
  ac_v_l2: number | null;
  ac_v_l3: number | null;
  ac_i_l1: number | null;
  ac_i_l2: number | null;
  ac_i_l3: number | null;
  ac_current: number | null;
  ac_freq: number | null;
  ac_power: number | null;
  ac_power_factor: number | null;
  ac_energy: number | null;
  dc_power: number | null;
  temp: number | null;
  backup_time_h: number | null;
  capacity_ah: number | null;
  max_cell_v: number | null;
  min_cell_v: number | null;
  max_cell_temp: number | null;
  min_cell_temp: number | null;
  cells_json: unknown;
  status: string | null;
};

type SiteRow = {
  id: number;
  name: string;
  location: string | null;
  site_type: string;
  device_name: string | null;
  ip: string | null;
  port: number | null;
  device_type: string | null;
};

const toNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value: number | null, digits = 1): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const hasAcPhase = (metric?: MetricRow) =>
  Boolean(metric && [metric.ac_v_l1, metric.ac_v_l2, metric.ac_v_l3].some(value => (value || 0) > 0));

const primaryAcVoltage = (metric?: MetricRow) =>
  metric ? [metric.ac_v_l1, metric.ac_v_l2, metric.ac_v_l3].find(value => (value || 0) > 0) || 0 : 0;

const newestTimestamp = (metrics: MetricRow[]) =>
  metrics
    .map(metric => new Date(metric.timestamp).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0] || null;

const probeOid = (ip: string, community: string, port: number, oid: string): Promise<string | null> => {
  const session = snmp.createSession(ip, community, {
    port,
    version: snmp.Version2c,
    timeout: 3000,
    retries: 1,
  });

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      session.close();
      resolve(null);
    }, 7000);

    session.get([oid], (error: any, varbinds: any[]) => {
      clearTimeout(timer);
      session.close();
      if (error || !varbinds?.[0] || snmp.isVarbindError(varbinds[0])) {
        resolve(null);
        return;
      }
      resolve(varbinds[0].value?.toString?.() ?? String(varbinds[0].value));
    });
  });
};

const detectSiteType = async (ip: string, community: string, port: number, requestedType?: string) => {
  const sysDescr = await probeOid(ip, community, port, '1.3.6.1.2.1.1.1.0');
  if (!sysDescr) {
    return { reachable: false, sysDescr: null, suggestedSiteType: requestedType || 'lithium', vendor: null, checks: {} };
  }

  const [huaweiSoc, ...probeResults] = await Promise.all([
    probeOid(ip, community, port, '1.3.6.1.4.1.2011.6.164.1.17.1.1.8.96'),
    probeOid(ip, community, port, '1.3.6.1.4.1.3902.2800.1.2.3.1.6.0'),
    probeOid(ip, community, port, '1.3.6.1.4.1.2011.6.164.1.18.2.1.5.3668'),
    probeOid(ip, community, port, '1.3.6.1.4.1.2011.6.164.1.18.2.1.5.3669'),
    probeOid(ip, community, port, '1.3.6.1.4.1.2011.6.164.1.18.2.1.5.3670'),
  ]);
  const [zteBusbar, ...huaweiLithiumVoltages] = probeResults;
  const huaweiLithiumVoltage = huaweiLithiumVoltages.find(Boolean) || null;

  const checks = {
    huaweiAcbSoc: huaweiSoc,
    huaweiLithiumBankVoltage: huaweiLithiumVoltage,
    huaweiLithiumBankVoltageCandidates: huaweiLithiumVoltages,
    zteBusbar,
  };
  if (zteBusbar && Number(zteBusbar) > 0) {
    return { reachable: true, sysDescr, suggestedSiteType: 'zte', vendor: 'zte', checks };
  }
  if (huaweiSoc || huaweiLithiumVoltage) {
    return { reachable: true, sysDescr, suggestedSiteType: 'lithium', vendor: 'huawei', checks };
  }
  return { reachable: true, sysDescr, suggestedSiteType: requestedType || 'lithium', vendor: 'unknown', checks };
};

const buildHermesSite = (site: SiteRow, rows: MetricRow[]) => {
  const ac = rows.find(row => row.device_type === 'ac_input');
  const batteries = rows.filter(row => row.device_type === 'battery');
  const load = rows.find(row => row.device_type === 'load');
  const rectifiers = rows.filter(row => row.device_type === 'rectifier');
  const latestMs = newestTimestamp(rows);
  const systemVoltage =
    batteries.find(row => (row.voltage || 0) > 0)?.voltage ||
    load?.voltage ||
    rectifiers.find(row => (row.voltage || 0) > 0)?.voltage ||
    54;
  const acOnline = hasAcPhase(ac);
  const batteryCurrent = batteries.reduce((sum, row) => sum + (row.current || 0), 0);
  const loadCurrent = load?.current ?? ac?.dc_power ?? null;
  const dcLoadWatts = load?.dc_power ?? (loadCurrent == null ? null : (systemVoltage || 54) * loadCurrent);
  const batteryPowerWatts = batteryCurrent === 0 ? 0 : Math.round((systemVoltage || 54) * batteryCurrent);
  const socRows = batteries.filter(row => row.soc != null);
  const capacityRows = batteries.filter(row => (row.capacity_ah || 0) > 0);
  const weightedCapacity = socRows.reduce((sum, row) => sum + (row.capacity_ah || 0), 0);
  const soc = weightedCapacity > 0
    ? socRows.reduce((sum, row) => sum + ((row.soc || 0) * (row.capacity_ah || 0)), 0) / weightedCapacity
    : (socRows.length ? socRows.reduce((sum, row) => sum + (row.soc || 0), 0) / socRows.length : null);
  const backupTimes = batteries.map(row => row.backup_time_h).filter((value): value is number => value != null && value > 0);
  const tempValues = batteries.flatMap(row => [row.min_cell_temp, row.max_cell_temp, row.temp]).filter((value): value is number => value != null);
  const isBatteryDischarging = batteryCurrent < -0.1 || (!acOnline && (dcLoadWatts || 0) > 0);
  const isBatteryCharging = batteryCurrent > 0.1;
  const ageSeconds = latestMs == null ? null : Math.max(0, Math.round((Date.now() - latestMs) / 1000));
  const stale = ageSeconds == null || ageSeconds > 180;
  const alarmLevel = stale || !acOnline ? 'critical' : (soc != null && soc < 30 ? 'warning' : 'normal');
  const status = stale
    ? 'NO_RECENT_DATA'
    : (!acOnline ? 'AC_INPUT_FAILURE' : (isBatteryDischarging ? 'ON_BATTERY' : 'GRID_NORMAL'));

  return {
    id: site.id,
    name: site.name,
    location: site.location,
    vendorType: site.site_type,
    device: {
      name: site.device_name,
      ip: site.ip,
      port: site.port,
      type: site.device_type,
    },
    status,
    alarmLevel,
    updatedAt: latestMs == null ? null : new Date(latestMs).toISOString(),
    ageSeconds,
    ac: {
      online: acOnline,
      status: ac?.status || (acOnline ? 'normal' : 'failure'),
      voltage: round(primaryAcVoltage(ac), 1),
      phases: {
        l1: { voltage: round(ac?.ac_v_l1 ?? null, 1), current: round(ac?.ac_i_l1 ?? null, 1) },
        l2: { voltage: round(ac?.ac_v_l2 ?? null, 1), current: round(ac?.ac_i_l2 ?? null, 1) },
        l3: { voltage: round(ac?.ac_v_l3 ?? null, 1), current: round(ac?.ac_i_l3 ?? null, 1) },
      },
      frequencyHz: round(ac?.ac_freq ?? null, 2),
      apparentPowerKva: round(ac?.ac_power == null ? null : ac.ac_power / 1000, 2),
      powerFactor: round(ac?.ac_power_factor ?? null, 2),
    },
    dcLoad: {
      watts: round(toNumber(dcLoadWatts), 0),
      kw: round(dcLoadWatts == null ? null : dcLoadWatts / 1000, 2),
      amps: round(loadCurrent, 2),
      voltage: round(systemVoltage, 1),
    },
    battery: {
      soc: soc == null ? null : Math.round(soc),
      bankCount: batteries.length,
      capacityAh: capacityRows.length ? round(capacityRows.reduce((sum, row) => sum + (row.capacity_ah || 0), 0), 0) : null,
      voltage: round(systemVoltage, 1),
      current: round(batteryCurrent, 2),
      powerWatts: batteryPowerWatts,
      backupTimeH: backupTimes.length ? round(Math.min(...backupTimes), 1) : null,
      state: isBatteryDischarging ? 'discharging' : (isBatteryCharging ? 'charging' : 'standby'),
      temperatureC: tempValues.length ? { min: round(Math.min(...tempValues), 0), max: round(Math.max(...tempValues), 0) } : null,
    },
  };
};

const getHermesSites = async () => {
  const [sitesResult, metricsResult] = await Promise.all([
    pool.query(`
      SELECT
        s.id, s.name, s.location, s.site_type,
        d.name AS device_name, d.ip, d.port, d.type AS device_type
      FROM sites s
      LEFT JOIN LATERAL (
        SELECT name, ip, port, type
        FROM devices
        WHERE site_id = s.id
        ORDER BY id
        LIMIT 1
      ) d ON true
      ORDER BY s.id
    `),
    pool.query('SELECT * FROM latest_metrics ORDER BY site_id, device_type, index')
  ]);

  const rows = metricsResult.rows as MetricRow[];
  return (sitesResult.rows as SiteRow[]).map(site => buildHermesSite(site, rows.filter(row => row.site_id === site.id)));
};

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  }
}));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Authentication Middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers['authorization'];
  if (token === 'Bearer nen-v2-token' || req.path === '/api/login') {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === 'admin') {
    res.json({ token: 'nen-v2-token' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Apply auth to all subsequent routes
app.use(requireAuth);


// Ingest metrics from agents
app.post('/api/metrics/ingest', async (req, res) => {
  const { siteId, metrics } = req.body;
  if (logIngest) console.log(`Received ${metrics.length} metrics from site ${siteId}. Types: ${metrics.map((m:any) => m.deviceType).join(', ')}`);
  try {
    for (const m of metrics) {
      await pool.query(
        'INSERT INTO metrics (site_id, device_type, index, voltage, current, soc, soh, ac_voltage, ac_v_l1, ac_v_l2, ac_v_l3, ac_i_l1, ac_i_l2, ac_i_l3, ac_current, ac_freq, ac_power, ac_power_factor, ac_energy, dc_power, temp, backup_time_h, capacity_ah, max_cell_v, min_cell_v, max_cell_temp, min_cell_temp, cells_json, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)',
        [
          siteId, m.deviceType, m.index, m.voltage, m.current, m.soc, m.soh,
          m.acVoltage, m.acVL1, m.acVL2, m.acVL3,
          m.acIL1, m.acIL2, m.acIL3,
          m.acCurrent, m.acFreq, m.acPower, m.acPowerFactor, m.acEnergy,
          m.dcPower, m.temp, m.backupTimeH, m.capacityAh, m.maxCellV, m.minCellV, m.maxCellTemp, m.minCellTemp,
          m.cellsJson ? JSON.stringify(m.cellsJson) : null,
          m.status
        ]
      );
      await pool.query(
        `
          INSERT INTO latest_metrics (
            site_id, device_type, index,
            voltage, current, soc, soh,
            ac_voltage, ac_v_l1, ac_v_l2, ac_v_l3, ac_i_l1, ac_i_l2, ac_i_l3,
            ac_current, ac_freq, ac_power, ac_power_factor, ac_energy,
            dc_power, temp, backup_time_h, capacity_ah,
            max_cell_v, min_cell_v, max_cell_temp, min_cell_temp, cells_json, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
          ON CONFLICT (site_id, device_type, index) DO UPDATE SET
            timestamp = NOW(),
            voltage = EXCLUDED.voltage,
            current = EXCLUDED.current,
            soc = EXCLUDED.soc,
            soh = EXCLUDED.soh,
            ac_voltage = EXCLUDED.ac_voltage,
            ac_v_l1 = EXCLUDED.ac_v_l1,
            ac_v_l2 = EXCLUDED.ac_v_l2,
            ac_v_l3 = EXCLUDED.ac_v_l3,
            ac_i_l1 = EXCLUDED.ac_i_l1,
            ac_i_l2 = EXCLUDED.ac_i_l2,
            ac_i_l3 = EXCLUDED.ac_i_l3,
            ac_current = EXCLUDED.ac_current,
            ac_freq = EXCLUDED.ac_freq,
            ac_power = EXCLUDED.ac_power,
            ac_power_factor = EXCLUDED.ac_power_factor,
            ac_energy = EXCLUDED.ac_energy,
            dc_power = EXCLUDED.dc_power,
            temp = EXCLUDED.temp,
            backup_time_h = EXCLUDED.backup_time_h,
            capacity_ah = EXCLUDED.capacity_ah,
            max_cell_v = EXCLUDED.max_cell_v,
            min_cell_v = EXCLUDED.min_cell_v,
            max_cell_temp = EXCLUDED.max_cell_temp,
            min_cell_temp = EXCLUDED.min_cell_temp,
            cells_json = EXCLUDED.cells_json,
            status = EXCLUDED.status
        `,
        [
          siteId, m.deviceType, m.index,
          m.voltage, m.current, m.soc, m.soh,
          m.acVoltage, m.acVL1, m.acVL2, m.acVL3,
          m.acIL1, m.acIL2, m.acIL3,
          m.acCurrent, m.acFreq, m.acPower, m.acPowerFactor, m.acEnergy,
          m.dcPower, m.temp, m.backupTimeH, m.capacityAh, m.maxCellV, m.minCellV, m.maxCellTemp, m.minCellTemp,
          m.cellsJson ? JSON.stringify(m.cellsJson) : null,
          m.status
        ]
      );
    }
    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Debug: Get all metrics
app.get('/api/metrics/all', async (req, res) => {
  const result = await pool.query('SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 50');
  res.json(result.rows);
});

// Get latest metrics for all sites
app.get('/api/metrics/latest', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM latest_metrics ORDER BY site_id, device_type, index');
    res.json(result.rows);
  } catch (error) {
    console.error('Latest metrics error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/hermes/summary', async (_req, res) => {
  try {
    const sites = await getHermesSites();
    const gridFailures = sites.filter(site => site.status === 'AC_INPUT_FAILURE');
    const staleSites = sites.filter(site => site.status === 'NO_RECENT_DATA');
    const batteryWarnings = sites.filter(site => site.battery.soc != null && site.battery.soc < 30);
    const socValues = sites.map(site => site.battery.soc).filter((value): value is number => value != null);
    const totalDcLoadKw = sites.reduce((sum, site) => sum + (site.dcLoad.kw || 0), 0);
    const updatedAt = sites
      .map(site => site.updatedAt ? new Date(site.updatedAt).getTime() : 0)
      .sort((a, b) => b - a)[0] || null;

    res.json({
      service: 'NEN',
      description: 'Network Electricity Node realtime power status',
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
      totals: {
        sites: sites.length,
        gridActive: sites.filter(site => site.ac.online).length,
        gridFailure: gridFailures.length,
        stale: staleSites.length,
        activeAlarms: gridFailures.length + staleSites.length + batteryWarnings.length,
        totalDcLoadKw: round(totalDcLoadKw, 2),
        averageBatterySoc: socValues.length
          ? Math.round(socValues.reduce((sum, value) => sum + value, 0) / socValues.length)
          : null,
      },
      alarms: [
        ...gridFailures.map(site => ({
          siteId: site.id,
          site: site.name,
          type: 'AC_INPUT_FAILURE',
          severity: 'critical',
          message: `${site.name} listrik PLN/AC input sedang padam atau tidak terbaca.`,
          batterySoc: site.battery.soc,
          backupTimeH: site.battery.backupTimeH,
          dcLoadKw: site.dcLoad.kw,
          updatedAt: site.updatedAt,
        })),
        ...staleSites.map(site => ({
          siteId: site.id,
          site: site.name,
          type: 'NO_RECENT_DATA',
          severity: 'critical',
          message: `${site.name} belum mengirim data terbaru.`,
          ageSeconds: site.ageSeconds,
          updatedAt: site.updatedAt,
        })),
        ...batteryWarnings.map(site => ({
          siteId: site.id,
          site: site.name,
          type: 'LOW_BATTERY_SOC',
          severity: 'warning',
          message: `${site.name} battery SOC rendah (${site.battery.soc}%).`,
          batterySoc: site.battery.soc,
          backupTimeH: site.battery.backupTimeH,
          updatedAt: site.updatedAt,
        })),
      ],
      sites,
    });
  } catch (error) {
    console.error('Hermes summary error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/hermes/sites', async (_req, res) => {
  try {
    res.json(await getHermesSites());
  } catch (error) {
    console.error('Hermes sites error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/hermes/sites/:id', async (req, res) => {
  try {
    const siteId = Number(req.params.id);
    const site = (await getHermesSites()).find(item => item.id === siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json(site);
  } catch (error) {
    console.error('Hermes site detail error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get historical metrics for a specific site
app.get('/api/metrics/history', async (req, res) => {
  const { siteId } = req.query;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });
  try {
    const result = await pool.query(`
      SELECT
        timestamp, device_type, index, voltage, current, soc, temp, backup_time_h, capacity_ah,
        ac_v_l1, ac_v_l2, ac_v_l3, ac_i_l1, ac_i_l2, ac_i_l3,
        ac_freq, ac_power, ac_power_factor, dc_power
      FROM metrics
      WHERE site_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'
      ORDER BY timestamp ASC
    `, [siteId]);
    res.json(result.rows);
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Export metrics as CSV
app.get('/api/export/csv', async (req, res) => {
  const { siteId } = req.query;
  try {
    let query = 'SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 5000';
    let params: any[] = [];
    if (siteId) {
      query = 'SELECT * FROM metrics WHERE site_id = $1 ORDER BY timestamp DESC LIMIT 5000';
      params.push(siteId);
    }
    const result = await pool.query(query, params);
    const rows = result.rows;
    if (rows.length === 0) return res.send('No data available');

    const headers = Object.keys(rows[0]).join(',');
    const csv = rows.map((r: any) => Object.values(r).map(v => `"${v}"`).join(',')).join('\n');

    res.header('Content-Type', 'text/csv');
    res.attachment(`nen_export_${siteId || 'all'}_${new Date().toISOString()}.csv`);
    res.send(`${headers}\n${csv}`);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/sites', async (req, res) => {
  const result = await pool.query('SELECT * FROM sites ORDER BY id');
  res.json(result.rows);
});

app.post('/api/sites/probe', async (req, res) => {
  const ip = typeof req.body.ip === 'string' ? req.body.ip.trim() : '';
  const community = req.body.community || (req.body.siteType === 'zte' ? 'public' : 'Anekanet');
  const port = Number(req.body.port) || 161;
  const siteType = req.body.siteType;

  if (!ip) {
    return res.status(400).json({ error: 'IP is required' });
  }

  try {
    const probe = await detectSiteType(ip, community, port, siteType);
    res.json({
      ...probe,
      ip,
      port,
      community,
      canSave: probe.reachable && probe.vendor !== 'unknown',
    });
  } catch (error) {
    console.error('Site probe error:', error);
    res.status(500).json({ error: 'Probe failed' });
  }
});

app.post('/api/sites', async (req, res) => {
  const {
    name,
    location,
    siteType,
    ip,
    port,
    community,
    deviceType,
    deviceName,
  } = req.body;
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedIp = typeof ip === 'string' ? ip.trim() : '';
  const normalizedSiteType = ['lithium', 'standard', 'zte'].includes(siteType) ? siteType : 'lithium';
  const normalizedDeviceType = deviceType || (normalizedSiteType === 'zte' ? 'zte_power' : 'huawei_enspire');
  const normalizedCommunity = community || (normalizedSiteType === 'zte' ? 'public' : 'Anekanet');
  const normalizedPort = Number(port) || 161;
  const normalizedDeviceName = deviceName || (normalizedSiteType === 'zte' ? 'ZTE ZXDU68' : normalizedSiteType === 'standard' ? 'Standard SMU' : 'Lithium SMU');

  if (!normalizedName || !normalizedIp) {
    return res.status(400).json({ error: 'Name and ip are required' });
  }
  try {
    const probe = await detectSiteType(normalizedIp, normalizedCommunity, normalizedPort, normalizedSiteType);
    if (!probe.reachable || probe.vendor === 'unknown') {
      return res.status(400).json({ error: 'SNMP probe failed. Check IP, port, community, and vendor type.', probe });
    }

    const existing = await pool.query(
      'SELECT s.* FROM sites s JOIN devices d ON d.site_id = s.id WHERE s.name = $1 OR d.ip = $2 LIMIT 1',
      [normalizedName, normalizedIp]
    );
    if (existing.rowCount) {
      return res.status(409).json({ error: 'Site name or IP already exists', site: existing.rows[0] });
    }
    const result = await pool.query(
      'INSERT INTO sites (name, location, site_type) VALUES ($1, $2, $3) RETURNING *',
      [normalizedName, location || 'Unknown', probe.suggestedSiteType || normalizedSiteType]
    );
    const site = result.rows[0];
    await pool.query(
      'INSERT INTO devices (site_id, name, ip, port, community, type, is_mock) VALUES ($1, $2, $3, $4, $5, $6, false)',
      [site.id, normalizedDeviceName, normalizedIp, normalizedPort, normalizedCommunity, normalizedDeviceType]
    );
    res.status(201).json(site);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/devices', async (req, res) => {
  const { siteId } = req.query;
  try {
    let query = 'SELECT * FROM devices';
    let params: any[] = [];
    if (siteId) {
      query += ' WHERE site_id = $1';
      params.push(siteId);
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/devices', async (req, res) => {
  const { siteId, name, ip, port, community, type } = req.body;
  if (!siteId || !name || !ip) {
    return res.status(400).json({ error: 'siteId, name, and ip are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO devices (site_id, name, ip, port, community, type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [siteId, name, ip, port || 161, community || 'public', type || 'huawei_enspire']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

initDb().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);

    // Schedule cleanup to run every 12 hours
    setInterval(() => {
      console.log('Running scheduled data cleanup...');
      runCleanup();
    }, 12 * 60 * 60 * 1000);

    // Run cleanup once on startup
    runCleanup();
  });
});
