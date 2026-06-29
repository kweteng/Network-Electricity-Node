import axios from 'axios';
import dotenv from 'dotenv';
import { pollHuaweiModbusData } from './modbus';
import { pollHuaweiBatterySummaryData, pollRealData, pollZteData, walkBatteries, walkRectifiers } from './snmp';

dotenv.config();

const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';
const authToken = 'Bearer nen-v2-token';
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS) || 60000;
const pollInitialDelayMs = Number(process.env.POLL_INITIAL_DELAY_MS) || 30000;
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || 15000;
const logPollDetails = process.env.LOG_POLL_DETAILS === 'true';
const modbusSiteIds = (process.env.MODBUS_SITE_IDS || '')
  .split(',')
  .map(id => Number(id.trim()))
  .filter(Boolean);
const modbusPort = Number(process.env.MODBUS_PORT || 502);
const modbusUnitId = Number(process.env.MODBUS_UNIT_ID || 1);

const estimateAcPowerFactor = (common: any) => {
  const reported = parseFloat(common.acPowerFactor);
  if (reported > 0 && reported <= 1) return reported;
  return null;
};

const parseBackupTimeH = (common: any) => {
  const value = parseFloat(common.battBackupTimeH);
  return Number.isFinite(value) && value > 0 ? value : null;
};

// Set default auth header for all axios requests
axios.defaults.headers.common['Authorization'] = authToken;
axios.defaults.timeout = requestTimeoutMs;


const generateMockMetrics = (siteId: number) => {
  const metrics: any[] = [];
  metrics.push({
    deviceType: 'ac_input',
    index: 1,
    acVL1: 220 + Math.random() * 5,
    acVL2: 218 + Math.random() * 5,
    acVL3: 221 + Math.random() * 5,
    status: 'normal',
  });
  for (let i = 1; i <= 4; i++) {
    metrics.push({
      deviceType: 'battery',
      index: i,
      voltage: 53.9,
      current: Math.random() * 2,
      soc: 90 + Math.random() * 10,
      status: 'float',
    });
  }
  return metrics;
};

const run = async () => {
  console.log('Agent starting (Dynamic Multi-Vendor Mode)...');
  console.log(`Polling interval: ${pollIntervalMs}ms, initial delay: ${pollInitialDelayMs}ms`);
  let isPolling = false;

  const pollCycle = async () => {
    if (isPolling) {
      console.warn('[SKIP] Previous polling cycle still running');
      return;
    }
    isPolling = true;
    try {
      const sitesRes = await axios.get(`${serverUrl}/api/sites`);
      const sites = sitesRes.data;

      for (const site of sites) {
        const devRes = await axios.get(`${serverUrl}/api/devices?siteId=${site.id}`);
        const devices = devRes.data;

        for (const device of devices) {
          if (device.is_mock) {
            const metrics = generateMockMetrics(site.id);
            await axios.post(`${serverUrl}/api/metrics/ingest`, { siteId: site.id, metrics });
            continue;
          }

          let metrics: any[] = [];
          const snmpPort = Number(device.port) || 161;
          if (logPollDetails) console.log(`Polling ${site.site_type.toUpperCase()} data for Site: ${site.name} IP: ${device.ip}:${snmpPort}`);

          try {
            if (site.site_type === 'zte') {
               const zte: any = await pollZteData(device.ip, device.community, snmpPort);
               const dcVoltage = parseInt(zte.busbar) / 100;
               const loadCurrent = parseInt(zte.loadCurrent) / 100;
               const batteryCurrent = parseInt(zte.battTotalCurrent) / 100;
               const acPower = (
                 (parseInt(zte.l1) || 0) * (parseInt(zte.l1I) || 0) +
                 (parseInt(zte.l2) || 0) * (parseInt(zte.l2I) || 0) +
                 (parseInt(zte.l3) || 0) * (parseInt(zte.l3I) || 0)
               );
               metrics.push({
                 deviceType: 'ac_input',
                 index: 1,
                 acVL1: parseInt(zte.l1),
                 acVL2: parseInt(zte.l2),
                 acVL3: parseInt(zte.l3),
                 acIL1: parseInt(zte.l1I),
                 acIL2: parseInt(zte.l2I),
                 acIL3: parseInt(zte.l3I),
                 acFreq: parseInt(zte.acFreq) / 10,
                 acPower,
                 dcPower: loadCurrent,
                 status: 'normal'
               });
               metrics.push({
                 deviceType: 'battery',
                 index: 1,
                 voltage: dcVoltage,
                 current: batteryCurrent,
                 soc: parseInt(zte.battTotalSOC),
                 dcPower: Math.round(dcVoltage * batteryCurrent),
                 temp: parseInt(zte.temperature) / 10,
                 status: 'online'
               });
               metrics.push({
                 deviceType: 'load',
                 index: 1,
                 voltage: dcVoltage,
                 current: loadCurrent,
                 dcPower: Math.round(dcVoltage * loadCurrent),
                 status: 'online'
               });
               if (Array.isArray(zte.batteryBanks)) {
                 for (const bank of zte.batteryBanks) {
                   metrics.push({
                     deviceType: 'battery_bank',
                     index: bank.index,
                     voltage: bank.voltage,
                     current: bank.current,
                     soc: bank.soc,
                     dcPower: Math.round(bank.voltage * bank.current),
                     status: 'online'
                   });
                 }
               }
            } else {
              let common: any;
              if (modbusSiteIds.includes(site.id)) {
                try {
                  common = await pollHuaweiModbusData(device.ip, modbusPort, modbusUnitId);
                  if (site.site_type === 'lithium') {
                    common = {
                      ...common,
                      ...(await pollHuaweiBatterySummaryData(device.ip, device.community, snmpPort)),
                    };
                  }
                  if (logPollDetails) console.log(`[MODBUS] Read realtime data for Site ${site.name}`);
                } catch (e: any) {
                  console.warn(`[MODBUS] Failed for ${site.name}; falling back to SNMP: ${e.message}`);
                  common = await pollRealData(device.ip, device.community, snmpPort);
                }
              } else {
                common = await pollRealData(device.ip, device.community, snmpPort);
              }

              const acVL1 = parseFloat(common.l1) || 0;
              const acVL2 = parseFloat(common.l2) || 0;
              const acVL3 = parseFloat(common.l3) || 0;
              const hasValidAcVoltage = [acVL1, acVL2, acVL3].some(v => v > 0);
              const hasValidDcContext = [
                common.busbar,
                common.loadCurrent,
                common.dcPower,
                common.battSummaryVoltage,
                common.battSummaryCurrent,
                common.battTotalCurrent,
              ].some(value => Math.abs(parseFloat(value)) > 0);

              if (hasValidAcVoltage || hasValidDcContext) {
                metrics.push({
                  deviceType: 'ac_input',
                  index: 1,
                  acVL1,
                  acVL2,
                  acVL3,
                  acIL1: parseFloat(common.l1I) || 0,
                  acIL2: parseFloat(common.l2I) || 0,
                  acIL3: parseFloat(common.l3I) || 0,
                  acFreq: parseFloat(common.acFreq) || null,
                  acPower: hasValidAcVoltage ? (parseFloat(common.acPower) || 0) : 0,
                  acPowerFactor: hasValidAcVoltage ? estimateAcPowerFactor(common) : null,
                  dcPower: parseInt(common.loadCurrent) / 10,
                  status: hasValidAcVoltage ? 'normal' : 'failure'
                });
              } else {
                console.warn(`[SKIP] AC input metrics invalid for ${site.name}; keeping previous valid reading`);
              }

              try {
                const rectifiers = await walkRectifiers(device.ip, device.community, snmpPort);
                for (const rectifier of rectifiers) {
                  metrics.push({
                    deviceType: 'rectifier',
                    index: rectifier.index,
                    voltage: rectifier.voltage,
                    current: rectifier.current,
                    acVoltage: rectifier.acVoltage,
                    dcPower: rectifier.dcPower,
                    temp: rectifier.temp,
                    status: rectifier.status,
                  });
                }
              } catch (e: any) {
                console.warn(`[RECTIFIER] Failed for ${site.name}; continuing without rectifier telemetry: ${e.message}`);
              }

              if (site.site_type === 'lithium') {
                const batteries: any = await walkBatteries(device.ip, device.community, snmpPort);
                const summarySoc = parseFloat(common.battSummarySOC);
                const legacySoc = parseInt(common.battTotalSOC);
                const backupTimeH = parseBackupTimeH(common);
                const fallbackSoc = summarySoc > 0 && summarySoc <= 100
                  ? summarySoc
                  : (legacySoc > 0 && legacySoc <= 100 ? legacySoc : null);
                for (const b of batteries) {
                  const cellVs = b.cells.map((c: any) => c.v).filter((v: number) => v > 0);
                  const cellTs = b.cells.map((c: any) => c.temp).filter((t: number) => t !== 0);
                  metrics.push({
                    deviceType: 'battery',
                    index: parseInt(b.index),
                    voltage: b.voltage,
                    current: b.current,
                    soc: fallbackSoc,
                    soh: b.soh,
                    dcPower: parseInt(common.dcPower), // Store actual DC Watts in the battery node if needed
                    backupTimeH,
                    capacityAh: b.capacityAh,
                    maxCellV: cellVs.length ? Math.max(...cellVs) : null,
                    minCellV: cellVs.length ? Math.min(...cellVs) : null,
                    maxCellTemp: cellTs.length ? Math.max(...cellTs) : null,
                    minCellTemp: cellTs.length ? Math.min(...cellTs) : null,
                    cellsJson: { cells: b.cells },
                    status: 'online'
                  });
                }
              } else {
                const summarySoc = parseFloat(common.battSummarySOC);
                const summaryCapacityAh = parseFloat(common.battSummaryCapacityAh);
                const summaryTemp = parseFloat(common.battSummaryTemp);
                const legacyChargeStatus = parseInt(common.battChargeStatus);
                const legacyStatusByCode: Record<number, string> = {
                  1: 'float',
                  2: 'boost',
                  3: 'discharge',
                  4: 'hibernating',
                  7: 'offline',
                  255: 'unknown',
                };
                const socRaw = summarySoc > 0 ? summarySoc : parseInt(common.battTotalSOC);
                const legacyCapacityAh = parseFloat(common.battRatedCapacity);
                const busbarVoltage = parseFloat(common.battSummaryVoltage) || (parseInt(common.busbar) / 10);
                const batteryCurrent = parseFloat(common.battSummaryCurrent) || (parseInt(common.battTotalCurrent) / 10);
                const dcPower = parseInt(common.dcPower);
                const remainAh = parseFloat(common.battRemainAh) / 10;
                const backupTimeH = parseBackupTimeH(common);
                const inferredSoc = remainAh > 0 && legacyCapacityAh > 0
                  ? Math.min(100, Math.max(0, (remainAh / legacyCapacityAh) * 100))
                  : null;
                const hasValidDcReading = busbarVoltage > 0 || batteryCurrent !== 0 || dcPower > 0 || summarySoc > 0 || summaryCapacityAh > 0 || legacyCapacityAh > 0;

                if (hasValidDcReading) {
                  metrics.push({
                    deviceType: 'battery',
                    index: 1,
                    voltage: busbarVoltage,
                    current: batteryCurrent,
                    soc: socRaw > 0 && socRaw <= 100 ? socRaw : inferredSoc,
                    dcPower, // Store DC Power Watts
                    temp: summaryTemp || null,
                    backupTimeH,
                    capacityAh: summaryCapacityAh || remainAh || legacyCapacityAh || null,
                    status: common.battSummaryStatus || legacyStatusByCode[legacyChargeStatus] || 'online'
                  });
                } else {
                  console.warn(`[SKIP] DC battery metrics invalid for ${site.name}; keeping previous valid reading`);
                }
              }
            }

            if (metrics.length > 0) {
              await axios.post(`${serverUrl}/api/metrics/ingest`, { siteId: site.id, metrics });
              if (logPollDetails) console.log(`[REAL] Pushed ${metrics.length} metrics for Site ${site.name}`);
            }

          } catch (e: any) {
            console.error(`Polling failed for ${site.name} (${device.ip}):`, e.message);
          }
        }
      }
    } catch (e: any) {
      console.error('Sync failed:', e.message, e.code);
    } finally {
      isPolling = false;
    }
  };

  setTimeout(() => {
    pollCycle();
    setInterval(pollCycle, pollIntervalMs);
  }, pollInitialDelayMs);
};

run();
