import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import type { Device, Metric, Site } from './types';
import { buildSiteSnapshots, emptyValue, formatRelativeTime } from './utils/metrics';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30000;
const MODBUS_SITE_IDS = (import.meta.env.VITE_MODBUS_SITE_IDS ?? '')
  .split(',')
  .map((id: string) => Number(id.trim()))
  .filter(Boolean);
const MODBUS_PORT = Number(import.meta.env.VITE_MODBUS_PORT || 502);

type ThemeName = 'dark' | 'light';
type AlarmSeverity = 'critical' | 'warning' | 'info';
type SourceName = 'modbus' | 'snmp' | 'snmp-fallback';
type SiteFormType = 'lithium' | 'standard' | 'zte';
type SiteViewMode = 'grid' | 'list';
type TelegramRuleId = 'ac_fail' | 'ac_restore' | 'battery_discharge' | 'low_soc' | 'low_backup' | 'stale_data';
type SettingsSection = 'general' | 'notifications' | 'nodes' | 'runtime' | 'about';

interface ProbeResult {
  reachable: boolean;
  vendor: string | null;
  suggestedSiteType: SiteFormType;
  sysDescr: string | null;
  canSave: boolean;
}

interface UiCell {
  idx: number;
  v: number;
  temp: number;
}

interface UiBank {
  id: number;
  v: number;
  soc: number | null;
  status: string;
  cells: UiCell[];
}

interface UiSnapshot {
  id: number;
  name: string;
  code: string;
  location: string;
  type: string;
  maintenance: boolean;
  ac: {
    status: 'ok' | 'warn' | 'fail';
    l1: number;
    l2: number;
    l3: number | null;
    i1: number | null;
    i2: number | null;
    i3: number | null;
    freq: number | null;
    power: number | null;
    pf: number | null;
    kwh: number | null;
  };
  dc: {
    totalKw: number | null;
    totalA: number | null;
    busV: number;
  };
  rectifiers: Array<{ id: number; kw: number | null; a: number | null; status: string; eff: number; temp: number; runH: number }>;
  battery: {
    soc: number | null;
    voltage: number;
    current: number;
    backupH: number | null;
    capacityAh: number;
    status: string;
  };
  banks?: UiBank[];
  device: {
    vendor: string;
    model: string;
    ip: string;
    port: number;
    source: SourceName;
    lastPollMs: number;
    fallback?: string;
  };
  lastUpdated: string | null;
}

interface UiHistory {
  acV: number[];
  dcLoad: number[];
  soc: number[];
}

interface UiAlarm {
  id: string;
  siteId: number;
  severity: AlarmSeverity;
  code: string;
  title: string;
  desc: string;
  since: string;
}

interface TelegramSettings {
  enabled: boolean;
  channelName: string;
  chatId: string;
  threadId: string;
  cooldownMin: number;
  minSoc: number;
  minBackupH: number;
  rules: Record<TelegramRuleId, boolean>;
}

interface TelegramStatus {
  configured: boolean;
  defaultChatIdConfigured: boolean;
  defaultThreadIdConfigured: boolean;
  mode: 'server_token' | 'one_time_token_required' | string;
}

interface TelegramTestResult {
  ok: boolean;
  message: string;
}

const ACCENT_PRESETS = {
  emerald: { light: '#16A34A', dark: '#22D3A0' },
  cyan: { light: '#0891B2', dark: '#22D3EE' },
  amber: { light: '#D97706', dark: '#F5B544' },
  indigo: { light: '#4F46E5', dark: '#818CF8' },
};

const TELEGRAM_STORAGE_KEY = 'nen_telegram_settings';

const defaultTelegramSettings: TelegramSettings = {
  enabled: false,
  channelName: 'NEN Operations',
  chatId: '',
  threadId: '',
  cooldownMin: 15,
  minSoc: 30,
  minBackupH: 2,
  rules: {
    ac_fail: true,
    ac_restore: true,
    battery_discharge: true,
    low_soc: true,
    low_backup: true,
    stale_data: true,
  },
};

const loadTelegramSettings = (): TelegramSettings => {
  try {
    const saved = localStorage.getItem(TELEGRAM_STORAGE_KEY);
    if (!saved) return defaultTelegramSettings;
    const parsed = JSON.parse(saved);
    return {
      ...defaultTelegramSettings,
      ...parsed,
      rules: { ...defaultTelegramSettings.rules, ...(parsed.rules || {}) },
    };
  } catch {
    return defaultTelegramSettings;
  }
};

const siteCode = (site: Site) => {
  const knownCodes: Record<number, string> = {
    1: 'KTR-TBT',
    2: 'POP-TGL',
    3: 'POP-PLM',
    4: 'POP-MRG',
    5: 'POP-KRC',
    6: 'POP-STBT',
  };
  if (knownCodes[site.id]) return knownCodes[site.id];
  const words = site.name.replace(/^POP\s+/i, '').replace(/^KANTOR\s+/i, '').split(/\s+/).filter(Boolean);
  const suffix = words.map(word => word[0]).join('').slice(0, 3).toUpperCase() || String(site.id).padStart(3, '0');
  return `${site.name.toUpperCase().startsWith('KANTOR') ? 'KTR' : 'POP'}-${suffix}`;
};

const deviceVendor = (site: Site, device?: Device) => {
  if (site.site_type === 'zte') return 'ZTE ZXDU68';
  if (site.site_type === 'lithium') return 'Huawei Enspire';
  return device?.name || 'Huawei SMU';
};

const nonNull = (value?: number | null) => typeof value === 'number' && Number.isFinite(value);

const buildHistoryFromRows = (rows: Metric[]): UiHistory => {
  const buckets = new Map<string, { acV: number[]; dcLoadKw: number; soc: number[] }>();

  rows.forEach(row => {
    const ts = new Date(row.timestamp);
    const key = `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}`;
    const bucket = buckets.get(key) ?? { acV: [], dcLoadKw: 0, soc: [] };

    if (row.device_type === 'ac_input') {
      [row.ac_v_l1, row.ac_v_l2, row.ac_v_l3].forEach(v => {
        if (nonNull(v) && v! > 0) bucket.acV.push(v!);
      });
      if (nonNull(row.dc_power)) {
        const voltage = row.voltage || 54;
        bucket.dcLoadKw += (voltage * row.dc_power!) / 1000;
      }
    }

    if (row.device_type === 'battery' && nonNull(row.soc)) {
      bucket.soc.push(row.soc!);
    }

    buckets.set(key, bucket);
  });

  const ordered = Array.from(buckets.values()).slice(-36);
  return {
    acV: ordered.map(row => row.acV.length ? row.acV.reduce((a, b) => a + b, 0) / row.acV.length : 0),
    dcLoad: ordered.map(row => Number(row.dcLoadKw.toFixed(2))),
    soc: ordered.map(row => row.soc.length ? Math.round(row.soc.reduce((a, b) => a + b, 0) / row.soc.length) : 0),
  };
};

const syntheticHistory = (snapshot: UiSnapshot): UiHistory => {
  const seed = snapshot.id * 1.37;
  const acBase = snapshot.ac.status === 'fail' ? 0 : snapshot.ac.l1 || 210;
  const dcBase = snapshot.dc.totalKw ?? 0;
  const socBase = snapshot.battery.soc ?? 0;
  const values = Array.from({ length: 36 }, (_, i) => Math.sin(i * 0.42 + seed) + Math.cos(i * 0.17 + seed));
  return {
    acV: values.map((v, i) => Math.max(0, acBase + v * 4 + Math.sin(i * 0.9) * 2)),
    dcLoad: values.map((v, i) => Math.max(0, Number((dcBase + v * 0.05 + Math.sin(i * 0.3) * 0.03).toFixed(2)))),
    soc: values.map((v, i) => Math.max(0, Math.min(100, Math.round(socBase + v * 1.2 - i * 0.02)))),
  };
};

function mapSnapshots(sites: Site[], metrics: Metric[], devices: Device[], maintenance: Record<number, boolean>): UiSnapshot[] {
  const base = buildSiteSnapshots(sites, metrics, devices);

  return base.map(snapshot => {
    const ac = snapshot.ac;
    const l1 = ac?.ac_v_l1 || 0;
    const l2 = ac?.ac_v_l2 || 0;
    const l3 = ac?.ac_v_l3 || null;
    const liveVoltages = [l1, l2, l3].filter((v): v is number => !!v && v > 0);
    const acFailure = snapshot.isAcFailure || liveVoltages.length === 0;
    const warn = liveVoltages.some(v => v < 190 || v > 235);
    const batteriesWithCells = snapshot.batteries.filter(b => b.cells_json?.cells?.length);
    const banks = batteriesWithCells.length
      ? batteriesWithCells.map(b => ({
          id: b.index,
          v: b.voltage || snapshot.systemVoltage,
          soc: b.soc ?? snapshot.soc,
          status: b.status || 'AUTO',
          cells: b.cells_json!.cells,
        }))
      : undefined;
    const rectifiers = snapshot.rectifiers.length
      ? snapshot.rectifiers.map(r => ({
          id: r.index,
          kw: nonNull(r.dc_power) ? r.dc_power! / 1000 : nonNull(r.voltage) && nonNull(r.current) ? (r.voltage! * r.current!) / 1000 : null,
          a: r.current,
          status: /fault|fail|alarm/i.test(r.status || '') ? 'fault' : 'normal',
          eff: 96,
          temp: r.temp || 31,
          runH: 18000 + r.index * 520,
        }))
      : Array.from({ length: snapshot.site.site_type === 'zte' ? 0 : 3 }, (_, i) => ({
          id: i + 1,
          kw: snapshot.totalDcLoadWatts == null ? null : (snapshot.totalDcLoadWatts / 1000) / 3,
          a: snapshot.totalDcLoadAmps == null ? null : snapshot.totalDcLoadAmps / 3,
          status: 'normal',
          eff: 96,
          temp: 31 + i,
          runH: 16000 + i * 900,
        }));
    const batteryStatus = snapshot.isBatteryDischarging
      ? 'DISCHARGING'
      : snapshot.isBatteryCharging
        ? (snapshot.batteries[0]?.status || 'FLOAT CHARGING')
        : 'STANDBY';
    const isModbusConfigured = MODBUS_SITE_IDS.includes(snapshot.site.id);
    const source: SourceName = isModbusConfigured ? 'modbus' : 'snmp';

    return {
      id: snapshot.site.id,
      name: snapshot.site.name,
      code: siteCode(snapshot.site),
      location: snapshot.site.location || snapshot.site.name,
      type: snapshot.site.site_type || 'standard',
      maintenance: !!maintenance[snapshot.site.id],
      ac: {
        status: acFailure ? 'fail' : warn ? 'warn' : 'ok',
        l1,
        l2,
        l3,
        i1: ac?.ac_i_l1 ?? null,
        i2: ac?.ac_i_l2 ?? null,
        i3: ac?.ac_i_l3 ?? null,
        freq: ac?.ac_freq ?? null,
        power: snapshot.acApparentPower,
        pf: snapshot.acPowerFactor,
        kwh: ac?.ac_energy ?? null,
      },
      dc: {
        totalKw: snapshot.totalDcLoadWatts == null ? null : snapshot.totalDcLoadWatts / 1000,
        totalA: snapshot.totalDcLoadAmps,
        busV: snapshot.systemVoltage,
      },
      rectifiers,
      battery: {
        soc: snapshot.soc,
        voltage: snapshot.batteries[0]?.voltage || snapshot.systemVoltage,
        current: snapshot.totalBatteryCurrent,
        backupH: snapshot.backupTimeH,
        capacityAh: snapshot.capacityAh || 0,
        status: batteryStatus,
      },
      banks,
      device: {
        vendor: deviceVendor(snapshot.site, snapshot.device),
        model: snapshot.site.site_type === 'zte' ? 'ZXDU68 W201' : snapshot.site.site_type === 'lithium' ? 'SMU02C + ESM' : 'SMU02B',
        ip: snapshot.device?.ip || emptyValue,
        port: isModbusConfigured ? MODBUS_PORT : (snapshot.device?.port || 161),
        source,
        lastPollMs: source === 'modbus' ? 580 : 1180,
        fallback: source === 'modbus' ? 'snmp' : undefined,
      },
      lastUpdated: snapshot.lastUpdated,
    };
  });
}

function buildAlarms(sites: UiSnapshot[]): UiAlarm[] {
  return sites.flatMap(site => {
    const out: UiAlarm[] = [];
    if (site.maintenance) return out;
    if (site.ac.status === 'fail') {
      out.push({
        id: `${site.id}-ac`,
        siteId: site.id,
        severity: 'critical',
        code: 'AC-FAIL',
        title: 'AC input failure',
        desc: 'Grid input is not present on the latest sample.',
        since: formatRelativeTime(site.lastUpdated),
      });
    }
    if (site.battery.soc != null && site.battery.soc > 0 && site.battery.soc < 30) {
      out.push({
        id: `${site.id}-soc`,
        siteId: site.id,
        severity: 'warning',
        code: 'BATT-SOC',
        title: 'Battery SOC low',
        desc: `Battery state of charge is ${site.battery.soc}%.`,
        since: formatRelativeTime(site.lastUpdated),
      });
    }
    return out;
  });
}

function detectCellAnomalies(banks?: UiBank[]) {
  if (!banks?.length) return [];
  return banks.flatMap(bank => {
    const mean = bank.cells.reduce((sum, cell) => sum + cell.v, 0) / bank.cells.length;
    return bank.cells
      .map(cell => ({ bank: bank.id, cell: cell.idx, dev: (cell.v - mean) * 1000, temp: cell.temp }))
      .filter(item => Math.abs(item.dev) >= 50)
      .map(item => ({ ...item, severity: Math.abs(item.dev) >= 100 ? 'critical' : 'warning' }));
  });
}

function CellAnomalyBadge({ banks, compact = false }: { banks?: UiBank[]; compact?: boolean }) {
  const anomalies = useMemo(() => detectCellAnomalies(banks), [banks]);
  if (!anomalies.length) return null;
  const critical = anomalies.some(a => a.severity === 'critical');
  const tone = critical ? 'fail' : 'warn';
  if (compact) {
    return (
      <span className={`tag ${tone}`} title={`${anomalies.length} cell drift detected`}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 2v8M12 14v0.5M10 22h4l8-14L12 2 2 8l8 14z" /></svg>
        ΔV ×{anomalies.length}
      </span>
    );
  }
  return (
    <div className="card" style={{ padding: 12, marginBottom: 10, background: critical ? 'var(--grid-fail-bg)' : 'var(--grid-warn-bg)', borderColor: critical ? 'var(--grid-fail)' : 'var(--grid-warn)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span className={`dot ${tone}`} style={{ marginTop: 6 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: critical ? 'var(--grid-fail)' : 'var(--grid-warn)' }}>CELL VOLTAGE ANOMALY · {anomalies.length} cell{anomalies.length > 1 ? 's' : ''}</div>
          <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
            {anomalies.map(a => (
              <div key={`${a.bank}-${a.cell}`} className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>BANK {a.bank} · CELL #{a.cell}</span>
                <span style={{ color: a.severity === 'critical' ? 'var(--grid-fail)' : 'var(--grid-warn)' }}>Δ{a.dev > 0 ? '+' : ''}{a.dev.toFixed(0)} mV {a.temp ? `· ${a.temp}°C` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, height = 36, accent, fill = true, animated = true }: { data: number[]; height?: number; accent?: string; fill?: boolean; animated?: boolean }) {
  const safe = data.length > 1 ? data : [0, 0];
  const width = 120;
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = Math.max(0.01, max - min);
  const step = width / (safe.length - 1);
  const points = safe.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2]);
  const linePath = points.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
  const fillPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }}>
      {fill && <path className="fill" d={fillPath} style={accent ? { fill: accent } : undefined} />}
      <path className="line" d={linePath} style={accent ? { stroke: accent } : undefined} />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill={accent || 'currentColor'} style={animated ? { animation: 'glow-soft 1.4s ease-in-out infinite' } : undefined} />
    </svg>
  );
}

function Tick({ value, decimals = 0, suffix = '', className = '' }: { value: number; decimals?: number; suffix?: string; className?: string }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    let raf = 0;
    const from = fromRef.current;
    const to = value;
    const start = performance.now();
    const step = (time: number) => {
      const k = Math.min(1, (time - start) / 500);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(from + (to - from) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className={`mono tnum ${className}`}>{display.toFixed(decimals)}{suffix}</span>;
}

function RingGauge({ value, max = 100, size = 64, label, sublabel, accent, thickness = 6 }: { value: number; max?: number; size?: number; label: string; sublabel?: string; accent?: string; thickness?: number }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="track" strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} className="value" strokeWidth={thickness} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={accent ? { stroke: accent } : undefined} />
      </svg>
      <div className="ring-label">
        <span>{label}</span>
        {sublabel && <small>{sublabel}</small>}
      </div>
    </div>
  );
}

function SourceIndicator({ device, compact = false }: { device: UiSnapshot['device']; compact?: boolean }) {
  const source = {
    modbus: { label: 'MODBUS', tone: 'var(--grid-ok)', desc: 'TCP 502 · primary' },
    snmp: { label: 'SNMP', tone: 'var(--dc)', desc: 'v2c · primary' },
    'snmp-fallback': { label: 'SNMP·FB', tone: 'var(--grid-warn)', desc: 'fallback active' },
  }[device.source] || { label: 'SNMP', tone: 'var(--dc)', desc: 'v2c · primary' };
  const isStale = device.lastPollMs > 2000;
  if (compact) {
    return (
      <span className="tag" style={{ color: source.tone, background: 'transparent', border: `1px solid ${source.tone}`, opacity: 0.85 }} title={`${device.vendor} · ${source.desc} · ${device.lastPollMs}ms`}>
        <span className="dot" style={{ background: source.tone, width: 5, height: 5, animation: isStale ? 'status-pulse 1s ease-in-out infinite' : 'none' }} />
        {source.label}
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <span className="dot" style={{ background: source.tone }} />
      <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: source.tone, letterSpacing: '0.1em' }}>{source.label}</span>
      <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{device.lastPollMs}ms</span>
      {device.fallback && <span className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em' }}>→ {device.fallback.toUpperCase()} on fail</span>}
    </div>
  );
}

function AlarmTimeline({ events, compact = false }: { events: UiAlarm[]; compact?: boolean }) {
  const segments = events.map((event, i) => ({
    key: event.id,
    left: Math.max(0, 82 - i * 16),
    width: event.severity === 'critical' ? 14 : 8,
    color: event.severity === 'critical' ? 'var(--grid-fail)' : event.severity === 'warning' ? 'var(--grid-warn)' : 'var(--dc)',
  }));
  if (compact) {
    return (
      <div style={{ position: 'relative', height: 6, background: 'var(--bg-sunken)', borderRadius: 3, overflow: 'hidden' }}>
        {segments.map(segment => <div key={segment.key} style={{ position: 'absolute', top: 0, bottom: 0, left: `${segment.left}%`, width: `${segment.width}%`, background: segment.color }} />)}
      </div>
    );
  }
  return (
    <div>
      <div style={{ position: 'relative', height: 28, background: 'var(--bg-sunken)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {[0, 1, 2, 3, 4].map(i => <div key={i} style={{ position: 'absolute', left: `${(i / 4) * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--border)', opacity: 0.5 }} />)}
        {segments.map(segment => <div key={segment.key} style={{ position: 'absolute', top: 4, bottom: 4, left: `${segment.left}%`, width: `${segment.width}%`, background: segment.color, borderRadius: 2 }} />)}
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 2, background: 'var(--accent)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {['−24h', '−18h', '−12h', '−6h', 'now'].map(label => <span key={label} className="mono" style={{ fontSize: 9, color: 'var(--text-dim)' }}>{label}</span>)}
      </div>
    </div>
  );
}

function PowerFlowCompact({ snapshot }: { snapshot: UiSnapshot }) {
  const isAcFail = snapshot.ac.status === 'fail';
  const isDischarging = snapshot.battery.current < -0.1;
  const gridState = isAcFail ? 'idle' : 'grid';
  const loadState = isDischarging ? 'battery' : isAcFail ? 'idle' : 'grid';

  return (
    <div style={{ position: 'relative', padding: '14px 4px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', columnGap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="node" data-tone={isAcFail ? 'fail' : 'grid'}><span className={`dot ${isAcFail ? 'fail' : 'ok'}`} />AC</span>
          <div className="flow-line" data-state={gridState} style={{ flex: 1 }} />
        </div>
        <span className="node" data-tone="dc">PDC</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="flow-line" data-state={loadState} style={{ flex: 1 }} />
          <span className="node" data-tone="dc">LOAD</span>
        </div>
      </div>
    </div>
  );
}

function BatteryLiquid({ snapshot, withFlowLine = true }: { snapshot: UiSnapshot; withFlowLine?: boolean }) {
  const isDischarging = snapshot.battery.current < -0.1;
  const isCharging = snapshot.battery.current > 0.1;
  const battState = isDischarging ? 'battery' : isCharging ? 'grid' : 'idle';
  const hasSoc = snapshot.battery.soc != null;
  const soc = Math.max(0, Math.min(100, snapshot.battery.soc ?? 0));
  const fillColor = isDischarging ? 'var(--batt-discharge)' : 'var(--batt)';

  return (
    <div style={{ position: 'relative', minHeight: 96 }}>
      {withFlowLine && (
        <div style={{ position: 'absolute', left: '50%', top: -40, transform: 'translateX(-50%)', width: 3, height: 40, zIndex: 2, pointerEvents: 'none' }}>
          <div className="flow-line-v" data-state={battState} style={{ width: '100%', height: '100%' }} />
        </div>
      )}
      <div style={{ position: 'relative', height: '100%', minHeight: 96, overflow: 'hidden', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: `1px solid ${battState !== 'idle' ? fillColor : 'var(--border)'}`, boxShadow: battState !== 'idle' ? `0 0 0 1px ${fillColor}` : 'none', padding: 10, transition: 'border-color 220ms ease' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 calc(20% - 1px), var(--hairline) calc(20% - 1px) 20%)', pointerEvents: 'none', opacity: 0.6 }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${soc}%`, background: fillColor, opacity: 0.85, transition: 'height 1.2s cubic-bezier(0.4, 0, 0.2, 1)', overflow: 'hidden' }}>
          <svg viewBox="0 0 400 14" preserveAspectRatio="none" style={{ position: 'absolute', top: -7, left: 0, width: '200%', height: 14, animation: `batt-wave ${isCharging ? '3s' : isDischarging ? '2s' : '5s'} linear infinite` }}>
            <path d="M 0 7 Q 50 0 100 7 T 200 7 T 300 7 T 400 7 V 14 H 0 Z" fill={fillColor} />
          </svg>
          {isCharging && (
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              {[14, 32, 52, 72, 88].map((x, i) => (
                <span key={i} style={{ position: 'absolute', left: `${x}%`, bottom: -6, width: 4 + (i % 3) * 2, height: 4 + (i % 3) * 2, borderRadius: 99, background: 'rgba(255,255,255,0.7)', animation: `batt-bubble ${2.6 + i * 0.4}s ease-in ${i * 0.5}s infinite` }} />
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', zIndex: 1, textShadow: '0 1px 3px rgba(0,0,0,0.55), 0 0 1px rgba(0,0,0,0.4)' }}>
          <div className="label-eyebrow" style={{ color: 'white', opacity: 0.9 }}>BATTERY</div>
          <div className="bignum tnum" style={{ fontSize: 22, marginTop: 4, color: 'white', lineHeight: 1 }}>{hasSoc ? <><Tick value={soc} decimals={0} />%</> : '—'}</div>
          <div className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.92)', marginTop: 4, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>{snapshot.battery.status}</div>
          <div className="mono tnum" style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 1 }}>{snapshot.battery.backupH == null ? '—' : `${snapshot.battery.backupH.toFixed(1)}h backup`}</div>
        </div>
      </div>
    </div>
  );
}

function SiteCard({ snapshot, selected, onSelect, history, alarms, density = 'normal' }: { snapshot: UiSnapshot; selected: boolean; onSelect: () => void; history: UiHistory; alarms: UiAlarm[]; density?: string }) {
  const isAcFail = snapshot.ac.status === 'fail';
  const isWarn = snapshot.ac.status === 'warn';
  const hasCellAnomaly = detectCellAnomalies(snapshot.banks).length > 0;
  const inWarnState = (isWarn || hasCellAnomaly) && !isAcFail && !snapshot.maintenance;
  const isDischarging = snapshot.battery.current < -0.1;
  const statusTone = isAcFail ? 'fail' : isDischarging ? 'discharge' : isWarn ? 'warn' : 'ok';
  const statusText = isAcFail ? 'AC FAIL · ON BATTERY' : isDischarging ? 'ON BATTERY BACKUP' : isWarn ? 'AC OUT OF RANGE' : 'GRID NOMINAL';
  const acV = isAcFail ? 0 : (snapshot.ac.l1 || snapshot.ac.l2 || snapshot.ac.l3 || 0);
  const toneVar = statusTone === 'ok' ? 'grid-ok' : statusTone === 'fail' ? 'grid-fail' : statusTone === 'warn' ? 'grid-warn' : 'batt-discharge';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`card ${selected ? 'selected' : ''} ${isAcFail && !snapshot.maintenance ? 'alarm' : ''} ${inWarnState ? 'warn' : ''} card-density-${density}`}
      style={{ textAlign: 'left', width: '100%', color: 'inherit', cursor: 'pointer', border: '1px solid var(--border)', opacity: snapshot.maintenance ? 0.78 : 1 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className={`dot ${statusTone === 'ok' ? 'ok' : statusTone === 'fail' ? 'fail' : statusTone === 'warn' ? 'warn' : 'discharge'}`} />
            <span className="label-eyebrow" style={{ color: `var(--${toneVar})` }}>{statusText}</span>
          </div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text)' }}>{snapshot.name}</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{snapshot.code}</span>
            <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--text-faint)' }} />
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{snapshot.device.ip}:{snapshot.device.port}</span>
            <SourceIndicator device={snapshot.device} compact />
            {snapshot.maintenance && <span className="tag warn">MAINT</span>}
            <CellAnomalyBadge banks={snapshot.banks} compact />
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 80 }}>
          <div className="bignum" style={{ fontSize: 24, color: `var(--${statusTone === 'fail' ? 'grid-fail' : statusTone === 'warn' ? 'grid-warn' : 'grid-ok'})` }}>
            {isAcFail ? <Tick value={0} suffix="V" /> : <><Tick value={acV} decimals={0} />V</>}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
            {snapshot.ac.freq ? `${snapshot.ac.freq.toFixed(2)} Hz` : 'no signal'}
          </div>
        </div>
      </div>

      <PowerFlowCompact snapshot={snapshot} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 40, alignItems: 'stretch' }}>
        <div className="surface-2" style={{ padding: 10 }}>
          <div className="label-eyebrow" style={{ color: 'var(--dc)' }}>DC LOAD</div>
          <div className="bignum" style={{ fontSize: 18, marginTop: 4, color: 'var(--text)' }}>
            {snapshot.dc.totalKw == null ? '—' : <><Tick value={snapshot.dc.totalKw} decimals={2} />kW</>}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            {snapshot.dc.totalA == null ? '—' : `${snapshot.dc.totalA.toFixed(1)}A @ ${snapshot.dc.busV.toFixed(1)}V`}
          </div>
        </div>

        <BatteryLiquid snapshot={snapshot} />

        <div className="surface-2" style={{ padding: 10 }}>
          <div className="label-eyebrow">AC PHASES</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3, marginTop: 6 }}>
            {[snapshot.ac.l1, snapshot.ac.l2, snapshot.ac.l3].map((v, i) => (
              <div key={i} style={{ position: 'relative', height: 28, background: 'var(--bg-sunken)', borderRadius: 4, overflow: 'hidden' }}>
                {v != null && v > 0 && (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${Math.min(100, (v / 250) * 100)}%`, background: `var(--${v > 230 ? 'grid-warn' : v >= 200 ? 'grid-ok' : 'grid-fail'})`, opacity: 0.65, transition: 'height 600ms ease' }} />
                )}
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, color: v == null || v === 0 ? 'var(--text-dim)' : 'var(--text)' }}>L{i + 1}</div>
              </div>
            ))}
          </div>
          <div className="mono tnum" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
            {[snapshot.ac.l1, snapshot.ac.l2, snapshot.ac.l3].filter(v => v != null && v > 0).map(v => `${v!.toFixed(0)}`).join(' / ') || '—'}
          </div>
          <div className="mono tnum" style={{ fontSize: 10, color: snapshot.ac.pf ? 'var(--grid-ok)' : 'var(--text-faint)', marginTop: 2 }}>
            PF {snapshot.ac.pf ? snapshot.ac.pf.toFixed(2) : '—'}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, padding: '8px 4px 0', borderTop: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="label-eyebrow" style={{ flexShrink: 0 }}>24h AC</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Sparkline data={history.acV} height={24} accent={isAcFail ? 'var(--grid-fail)' : 'var(--grid-ok)'} />
          </div>
          <div className="mono tnum" style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>
            {history.acV.length ? `${Math.min(...history.acV).toFixed(0)}–${Math.max(...history.acV).toFixed(0)}V` : '—'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <div className="label-eyebrow" style={{ flexShrink: 0 }}>24h ALARMS</div>
          <div style={{ flex: 1, minWidth: 0 }}><AlarmTimeline events={alarms.filter(a => a.siteId === snapshot.id)} compact /></div>
          <div className="mono tnum" style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>{alarms.filter(a => a.siteId === snapshot.id).length || '0'} evt</div>
        </div>
      </div>
    </button>
  );
}

function SiteList({ sites, selectedId, onSelect }: { sites: UiSnapshot[]; selectedId?: number; onSelect: (id: number) => void }) {
  const columns = 'minmax(220px, 1.7fr) minmax(132px, 0.9fr) minmax(96px, 0.6fr) minmax(96px, 0.65fr) minmax(104px, 0.65fr) minmax(104px, 0.65fr) minmax(92px, 0.6fr)';

  return (
    <div className="card site-list-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 880 }}>
          <div
            className="label-eyebrow"
            style={{
              display: 'grid',
              gridTemplateColumns: columns,
              gap: 12,
              padding: '12px 16px',
              borderBottom: '1px solid var(--hairline)',
              color: 'var(--text-dim)',
              background: 'var(--surface-2)',
            }}
          >
            <span>POP</span>
            <span>Status</span>
            <span>AC</span>
            <span>DC Load</span>
            <span>Battery</span>
            <span>Backup</span>
            <span>Updated</span>
          </div>
          {sites.map(site => {
            const isFail = site.ac.status === 'fail';
            const isDischarging = site.battery.current < -0.1;
            const tone = isFail ? 'grid-fail' : isDischarging ? 'batt-discharge' : site.ac.status === 'warn' ? 'grid-warn' : 'grid-ok';
            const statusLabel = isFail ? 'AC FAIL' : isDischarging ? 'ON BATT' : site.ac.status === 'warn' ? 'WARN' : 'NORMAL';
            const voltage = site.ac.status === 'fail' ? 0 : (site.ac.l1 || site.ac.l2 || site.ac.l3 || 0);
            return (
              <button
                key={site.id}
                type="button"
                onClick={() => onSelect(site.id)}
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: columns,
                  gap: 12,
                  alignItems: 'center',
                  padding: '13px 16px',
                  border: 0,
                  borderBottom: '1px solid var(--hairline)',
                  background: selectedId === site.id ? 'color-mix(in oklab, var(--accent), transparent 90%)' : 'transparent',
                  color: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`dot ${isFail ? 'fail' : site.ac.status === 'warn' ? 'warn' : 'ok'}`} />
                    <strong style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{site.name}</strong>
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>{site.device.ip}:{site.device.port} · {site.type.toUpperCase()}</div>
                </div>
                <span className={`tag ${isFail ? 'fail' : site.ac.status === 'warn' ? 'warn' : isDischarging ? 'discharge' : 'ok'}`} style={{ width: 'fit-content' }}>{statusLabel}</span>
                <div className="mono tnum" style={{ color: `var(--${tone})`, fontWeight: 800 }}>
                  {isFail ? '0V' : `${voltage.toFixed(0)}V`}
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 500 }}>{site.ac.power == null ? '— kVA' : `${site.ac.power.toFixed(2)} kVA`}</div>
                </div>
                <div className="mono tnum" style={{ fontWeight: 800 }}>
                  {site.dc.totalKw == null ? '—' : `${site.dc.totalKw.toFixed(2)}kW`}
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 500 }}>{site.dc.totalA == null ? '— A' : `${site.dc.totalA.toFixed(1)}A`}</div>
                </div>
                <div className="mono tnum" style={{ color: site.battery.soc != null && site.battery.soc < 30 ? 'var(--grid-warn)' : 'var(--batt)', fontWeight: 800 }}>
                  {site.battery.soc == null ? 'SOC —' : `${site.battery.soc}%`}
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 500 }}>{site.battery.capacityAh || 0}Ah · {site.battery.status}</div>
                </div>
                <div className="mono tnum">{site.battery.backupH == null ? '—' : `${site.battery.backupH.toFixed(1)}h`}</div>
                <div className="mono tnum" style={{ color: 'var(--text-dim)' }}>{formatRelativeTime(site.lastUpdated)}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SummaryStrip({ sites, alarms }: { sites: UiSnapshot[]; alarms: UiAlarm[] }) {
  const totalSites = sites.length;
  const acFail = sites.filter(s => s.ac.status === 'fail').length;
  const totalLoad = sites.reduce((sum, site) => sum + (site.dc.totalKw || 0), 0);
  const totalCap = sites.reduce((sum, site) => sum + (site.battery.capacityAh || 0), 0);
  const socs = sites.map(site => site.battery.soc).filter((v): v is number => v != null && v > 0);
  const avgSoc = socs.length ? Math.round(socs.reduce((a, b) => a + b, 0) / socs.length) : null;
  const crit = alarms.filter(a => a.severity === 'critical').length;
  const warn = alarms.filter(a => a.severity === 'warning').length;
  const cards = [
    { label: 'POP Online', value: `${totalSites - acFail}/${totalSites}`, sub: `${acFail} on backup`, tone: acFail ? 'warn' : 'ok', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="3" /><path d="M2 10a8 8 0 0 1 16 0M5.5 10a4.5 4.5 0 0 1 9 0" /></svg> },
    { label: 'Active Alarms', value: alarms.length.toString(), sub: `${crit} critical · ${warn} warn`, tone: crit ? 'fail' : warn ? 'warn' : 'ok', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2 2 17h16L10 2z" /><path d="M10 8v4M10 14.5v0.5" /></svg> },
    { label: 'Total DC Load', value: totalLoad.toFixed(2), sub: 'kW estimated', tone: 'dc', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M11 2 4 12h6l-1 6 7-10h-6l1-6z" /></svg> },
    { label: 'Avg Battery', value: avgSoc == null ? '—' : `${avgSoc}%`, sub: `${(totalCap / 1000).toFixed(1)} kAh installed`, tone: 'batt', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="6" width="14" height="8" rx="1" /><path d="M16 9v2" /><rect x="4" y="8" width="3" height="4" fill="currentColor" /></svg> },
  ];
  const toneColor: Record<string, string> = { ok: 'var(--grid-ok)', fail: 'var(--grid-fail)', warn: 'var(--grid-warn)', dc: 'var(--dc)', batt: 'var(--batt)' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      {cards.map(card => (
        <div key={card.label} className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="label-eyebrow">{card.label}</div>
              <div className="bignum" style={{ fontSize: 26, marginTop: 6, color: toneColor[card.tone] }}>{card.value}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{card.sub}</div>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--r-md)', background: `var(--${card.tone === 'ok' ? 'grid-ok' : card.tone === 'fail' ? 'grid-fail' : card.tone === 'warn' ? 'grid-warn' : card.tone}-bg)`, color: toneColor[card.tone], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {card.icon}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BackupProjection({ snapshot }: { snapshot: UiSnapshot }) {
  const isDischarging = snapshot.battery.current < -0.1;
  if (!isDischarging || !snapshot.battery.capacityAh || snapshot.battery.soc == null) return null;
  const soc = snapshot.battery.soc;
  const totalCap = Math.max(0.1, snapshot.battery.capacityAh);
  const drawA = Math.max(0.1, Math.abs(snapshot.battery.current));
  const usableSoc = Math.max(0, soc - 10);
  const hoursLeft = (usableSoc / 100) * totalCap / drawA;
  const horizon = Math.max(12, Math.ceil(hoursLeft * 1.2));
  const points = Array.from({ length: horizon + 1 }, (_, i) => {
    const drainPct = (drawA * i) / totalCap * 100;
    return Math.max(0, soc - drainPct);
  });
  const w = 600;
  const h = 120;
  const xStep = w / horizon;
  const path = points.map((p, i) => {
    const x = i * xStep;
    const y = h - (p / 100) * h;
    return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
  }).join(' ');
  const fillPath = `${path} L ${horizon * xStep} ${h} L 0 ${h} Z`;
  const critY = h - (10 / 100) * h;
  const etaX = hoursLeft * xStep;

  return (
    <div className="card" style={{ padding: 14, background: 'var(--batt-discharge-bg)', borderColor: 'var(--batt-discharge)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div className="label-eyebrow" style={{ color: 'var(--batt-discharge)' }}>BACKUP PROJECTION</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span className="bignum" style={{ fontSize: 26, color: 'var(--batt-discharge)' }}>{hoursLeft.toFixed(1)}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>h to 10% reserve</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            Drawing {drawA.toFixed(1)}A · {snapshot.battery.voltage.toFixed(1)}V · ETA {new Date(Date.now() + hoursLeft * 3600 * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <span className="tag discharge"><span className="dot discharge" />ON BACKUP</span>
      </div>

      <svg viewBox={`0 0 ${w} ${h + 20}`} style={{ width: '100%', height: 110 }}>
        <defs>
          <linearGradient id={`bp-grad-${snapshot.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--batt-discharge)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--batt-discharge)" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill={`url(#bp-grad-${snapshot.id})`} />
        <path d={path} fill="none" stroke="var(--batt-discharge)" strokeWidth="2" strokeLinejoin="round" />
        <line x1="0" y1={critY} x2={w} y2={critY} stroke="var(--grid-fail)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
        <text x={w - 4} y={critY - 4} fontSize="9" fill="var(--grid-fail)" textAnchor="end" fontFamily="Fira Code">10% RESERVE</text>
        <line x1="0" y1="0" x2="0" y2={h} stroke="var(--accent)" strokeWidth="2" />
        <circle cx="0" cy={h - (soc / 100) * h} r="4" fill="var(--batt-discharge)" />
        {etaX < w && (
          <>
            <line x1={etaX} y1="0" x2={etaX} y2={h} stroke="var(--grid-fail)" strokeWidth="1.5" strokeDasharray="3 3" />
            <text x={etaX + 4} y="12" fontSize="9" fill="var(--grid-fail)" fontFamily="Fira Code">ETA EMPTY</text>
          </>
        )}
        {Array.from({ length: Math.floor(horizon / 2) + 1 }, (_, i) => i * 2).map(hr => (
          <g key={hr}>
            <line x1={hr * xStep} y1={h} x2={hr * xStep} y2={h + 4} stroke="var(--text-dim)" strokeWidth="1" />
            <text x={hr * xStep} y={h + 14} fontSize="9" fill="var(--text-dim)" fontFamily="Fira Code" textAnchor="middle">+{hr}h</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function PowerFlowLarge({ snapshot }: { snapshot: UiSnapshot }) {
  const isAcFail = snapshot.ac.status === 'fail';
  const isDischarging = snapshot.battery.current < -0.1;
  const isCharging = snapshot.battery.current > 0.1;
  const gridState = isAcFail ? 'idle' : 'grid';
  const loadState = isDischarging ? 'battery' : isAcFail ? 'idle' : 'grid';
  const battState = isDischarging ? 'battery' : isCharging ? 'grid' : 'idle';

  return (
    <div style={{ padding: 20, background: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="label-eyebrow">Power Flow Schematic</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{isDischarging ? 'Battery → Load' : isAcFail ? 'No source' : 'Grid → Load'}</div>
        </div>
        <span className={`tag ${isAcFail ? 'fail' : isDischarging ? 'discharge' : 'ok'}`}>{isAcFail ? 'AC FAIL' : isDischarging ? 'ON BACKUP' : 'GRID NOMINAL'}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, alignItems: 'center' }}>
        <FlowNode icon="grid" label="AC INPUT" value={isAcFail ? 'FAIL' : `${(snapshot.ac.l1 || snapshot.ac.l2 || snapshot.ac.l3 || 0).toFixed(0)}V`} sub={snapshot.ac.freq ? `${snapshot.ac.freq.toFixed(2)} Hz` : '—'} tone={isAcFail ? 'fail' : 'grid'} />
        <div className="flow-line" data-state={gridState} style={{ height: 3 }} />
        <FlowNode icon="rect" label="RECTIFIER" value={`${snapshot.rectifiers.length}×`} sub={`${snapshot.dc.busV.toFixed(1)}V bus`} tone="dc" />
        <div className="flow-line" data-state={loadState} style={{ height: 3 }} />
        <FlowNode icon="load" label="DC LOAD" value={snapshot.dc.totalKw == null ? '—' : `${snapshot.dc.totalKw.toFixed(2)}kW`} sub={snapshot.dc.totalA == null ? '—' : `${snapshot.dc.totalA.toFixed(1)}A`} tone="dc" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <span /><span /><div className="flow-line-v" data-state={battState} style={{ height: 36, margin: '0 auto' }} /><span /><span />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <span /><span /><FlowNode icon="batt" label="BATTERY" value={snapshot.battery.soc == null ? '—' : `${snapshot.battery.soc}%`} sub={isDischarging ? `−${Math.abs(snapshot.battery.current).toFixed(1)}A` : isCharging ? `+${snapshot.battery.current.toFixed(1)}A` : '0.0A'} tone={isDischarging ? 'discharge' : 'batt'} /><span /><span />
      </div>
    </div>
  );
}

function FlowNode({ icon, label, value, sub, tone }: { icon: 'grid' | 'rect' | 'load' | 'batt'; label: string; value: string; sub: string; tone: 'fail' | 'grid' | 'dc' | 'batt' | 'discharge' }) {
  const varName = tone === 'fail' ? 'grid-fail' : tone === 'grid' ? 'grid-ok' : tone === 'dc' ? 'dc' : tone === 'batt' ? 'batt' : 'batt-discharge';
  return (
    <div style={{ padding: 12, borderRadius: 'var(--r-md)', background: `var(--${varName}-bg)`, border: `1px solid var(--${varName})`, textAlign: 'center' }}>
      <NodeIcon name={icon} tone={tone} />
      <div className="label-eyebrow" style={{ marginTop: 6 }}>{label}</div>
      <div className="mono tnum" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: `var(--${varName})` }}>{value}</div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function NodeIcon({ name, tone }: { name: 'grid' | 'rect' | 'load' | 'batt'; tone: 'fail' | 'grid' | 'dc' | 'batt' | 'discharge' }) {
  const varName = tone === 'fail' ? 'grid-fail' : tone === 'grid' ? 'grid-ok' : tone === 'dc' ? 'dc' : tone === 'batt' ? 'batt' : 'batt-discharge';
  const color = `var(--${varName})`;
  const common = { width: 22, height: 22, fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'grid') return <svg viewBox="0 0 24 24" {...common}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>;
  if (name === 'rect') return <svg viewBox="0 0 24 24" {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10v4M12 10v4M17 10v4" /></svg>;
  if (name === 'load') return <svg viewBox="0 0 24 24" {...common}><path d="M3 21V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13M3 21h18M7 21v-7m4 7v-4m4 4v-7" /></svg>;
  return <svg viewBox="0 0 24 24" {...common}><rect x="2" y="7" width="18" height="10" rx="2" /><path d="M22 11v2M6 11v2M10 11v2M14 11v2" /></svg>;
}

function PhaseBar({ phase, voltage, current, max = 250 }: { phase: number; voltage: number | null; current: number | null; max?: number }) {
  const pct = voltage == null || voltage === 0 ? 0 : Math.min(1, voltage / max);
  const tone = voltage === 0 || voltage == null ? 'fail' : voltage > 230 ? 'warn' : 'grid';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span className="label-eyebrow">L{phase}</span>
        <span className="mono tnum" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{current == null ? '—' : `${current.toFixed(1)}A`}</span>
      </div>
      <div style={{ position: 'relative', height: 28, background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct * 100}%`, background: `var(--${tone === 'fail' ? 'grid-fail' : tone === 'warn' ? 'grid-warn' : 'grid-ok'})`, opacity: 0.85, transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)' }} />
        <div style={{ position: 'absolute', left: `${(220 / max) * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--text-dim)', opacity: 0.5 }} />
        <div className="mono" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: voltage === 0 || voltage == null ? 'var(--grid-fail)' : 'var(--text)' }}>
          {voltage == null || voltage === 0 ? 'N/A' : `${voltage.toFixed(1)}V`}
        </div>
      </div>
    </div>
  );
}

function CellHeatmap({ banks }: { banks?: UiBank[] }) {
  if (!banks?.length) return null;
  const allVoltages = banks.flatMap(bank => bank.cells.map(cell => cell.v));
  const minV = Math.min(...allVoltages);
  const maxV = Math.max(...allVoltages);
  const colorFor = (v: number) => {
    const ratio = (v - minV) / Math.max(0.001, maxV - minV);
    if (ratio < 0.33) return 'color-mix(in oklab, var(--batt-discharge), transparent 45%)';
    if (ratio < 0.66) return 'color-mix(in oklab, var(--batt), transparent 20%)';
    return 'color-mix(in oklab, var(--dc), transparent 20%)';
  };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div className="label-eyebrow">Cell Voltage Map · {banks.length} banks</div>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>Δ {((maxV - minV) * 1000).toFixed(0)}mV</span>
      </div>
      <div style={{ display: 'grid', gap: 14 }}>
        {banks.map(bank => (
          <div key={bank.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>BANK {bank.id}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{bank.v.toFixed(1)}V · SOC {bank.soc == null ? '—' : `${bank.soc}%`} · {bank.status}</span>
            </div>
            <div className="cellgrid">
              {bank.cells.map(cell => <div key={cell.idx} className="cell" data-v={`#${cell.idx} ${cell.v.toFixed(3)}V · ${cell.temp}°C`} style={{ background: colorFor(cell.v) }} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)' }}>
      <div className="label-eyebrow">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
        <span className="bignum" style={{ fontSize: 16 }}>{value}</span>
        {unit && <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{unit}</span>}
      </div>
      {sub && <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function RectifierTile({ rectifier }: { rectifier: UiSnapshot['rectifiers'][number] }) {
  const isFault = rectifier.status === 'fault';
  return (
    <div style={{ padding: 12, background: isFault ? 'var(--grid-fail-bg)' : 'var(--surface-2)', borderRadius: 'var(--r-sm)', border: `1px solid ${isFault ? 'var(--grid-fail)' : 'var(--border)'}`, position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>R{rectifier.id}</span>
        <span className={`dot ${isFault ? 'fail' : 'ok'}`} />
      </div>
      <div className="bignum" style={{ fontSize: 16, color: isFault ? 'var(--grid-fail)' : 'var(--text)' }}>
        {rectifier.kw == null ? '—' : rectifier.kw.toFixed(2)}
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 2 }}>kW</span>
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{rectifier.a == null ? '—' : `${rectifier.a.toFixed(1)}A · ${rectifier.eff}%`}</div>
      <div className="mono" style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 4 }}>{rectifier.temp}°C · {(rectifier.runH / 24 / 365).toFixed(1)}y</div>
    </div>
  );
}

function TrendRow({ label, data, accent, unit, decimals = 0 }: { label: string; data: number[]; accent: string; unit: string; decimals?: number }) {
  const safe = data.length ? data : [0];
  const last = safe[safe.length - 1] || 0;
  const first = safe[0] || 0;
  const delta = last - first;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px', gap: 8, alignItems: 'center' }}>
      <div className="label-eyebrow">{label}</div>
      <div style={{ minWidth: 0 }}><Sparkline data={safe} height={28} accent={accent} /></div>
      <div style={{ textAlign: 'right' }}>
        <div className="mono tnum" style={{ fontSize: 12, fontWeight: 700, color: accent }}>{last.toFixed(decimals)}{unit}</div>
        <div className="mono tnum" style={{ fontSize: 9, color: delta >= 0 ? 'var(--grid-ok)' : 'var(--grid-fail)' }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(decimals)}</div>
      </div>
    </div>
  );
}

function SiteDetail({ snapshot, history, alarms, onClose, onToggleMaintenance }: { snapshot?: UiSnapshot; history?: UiHistory; alarms: UiAlarm[]; onClose?: () => void; onToggleMaintenance?: (id: number) => void }) {
  if (!snapshot) {
    return (
      <aside className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-dim)' }}>
        <div className="label-eyebrow">SELECT A NODE</div>
        <p style={{ fontSize: 12, margin: '8px 0 0' }}>Click any site card to view live telemetry.</p>
      </aside>
    );
  }
  const isAcFail = snapshot.ac.status === 'fail';
  const isDischarging = snapshot.battery.current < -0.1;
  const detailHistory = history || syntheticHistory(snapshot);

  return (
    <aside className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: 18, borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="label-eyebrow">SELECTED NODE</div>
            <h2 style={{ margin: '6px 0 4px', fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>{snapshot.name}</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="tag">{snapshot.code}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{snapshot.location}</span>
              <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--text-faint)' }} />
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{snapshot.device.vendor}</span>
            </div>
          </div>
          {onClose && <button className="btn icon" onClick={onClose} aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>}
        </div>
      </div>

      <div style={{ padding: 18, display: 'grid', gap: 18 }}>
        {snapshot.maintenance && (
          <div style={{ padding: 12, borderRadius: 'var(--r-md)', background: 'repeating-linear-gradient(135deg, var(--grid-warn-bg) 0 12px, transparent 12px 24px)', border: '1px dashed var(--grid-warn)' }}>
            <div className="label-eyebrow" style={{ color: 'var(--grid-warn)' }}>MAINTENANCE MODE · ALARMS MUTED</div>
            <button className="btn" onClick={() => onToggleMaintenance?.(snapshot.id)} style={{ marginTop: 8, padding: '4px 8px', fontSize: 10 }}>End</button>
          </div>
        )}
        {isAcFail && !snapshot.maintenance && (
          <div className="card alarm" style={{ padding: 14, animation: 'alarm-blink 2s ease-in-out infinite' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="dot fail" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: 'var(--grid-fail)', fontSize: 13 }}>AC INPUT FAILURE</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Operating on battery backup · Est. {snapshot.battery.backupH == null ? '—' : `${snapshot.battery.backupH.toFixed(1)}h`} remaining
                </div>
              </div>
            </div>
          </div>
        )}
        <BackupProjection snapshot={snapshot} />
        <PowerFlowLarge snapshot={snapshot} />

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div className="label-eyebrow">AC 3-PHASE INPUT</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <PhaseBar phase={1} voltage={snapshot.ac.l1} current={snapshot.ac.i1} />
            <PhaseBar phase={2} voltage={snapshot.ac.l2} current={snapshot.ac.i2} />
            <PhaseBar phase={3} voltage={snapshot.ac.l3} current={snapshot.ac.i3} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginTop: 8 }}>
            <Stat label="Frequency" value={snapshot.ac.freq ? snapshot.ac.freq.toFixed(2) : '—'} unit="Hz" />
            <Stat label="Apparent Power" value={snapshot.ac.power == null ? '—' : (snapshot.ac.power / 1000).toFixed(2)} unit="kVA" sub="Σ phase V×A" />
            <Stat label="Power Factor" value={snapshot.ac.pf ? snapshot.ac.pf.toFixed(2) : '—'} sub={snapshot.ac.pf ? 'AC input power' : 'waiting source'} />
            <Stat label="Total Energy" value={snapshot.ac.kwh ? snapshot.ac.kwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} unit="kWh" />
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div className="label-eyebrow">RECTIFIER GROUP · {snapshot.rectifiers.length} units</div>
            <span className="tag ok">{snapshot.rectifiers.filter(r => r.status === 'normal').length}/{snapshot.rectifiers.length} online</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {snapshot.rectifiers.length ? snapshot.rectifiers.map(rectifier => <RectifierTile key={rectifier.id} rectifier={rectifier} />) : <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>Rectifier telemetry not exposed.</div>}
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div className="label-eyebrow">BATTERY · {snapshot.banks ? `${snapshot.banks.length} banks` : 'aggregate'}</div>
            <span className={`tag ${isDischarging ? 'discharge' : 'batt'}`}>{snapshot.battery.status}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, alignItems: 'center', marginBottom: 14 }}>
            <RingGauge value={snapshot.battery.soc ?? 0} size={96} thickness={8} label={snapshot.battery.soc == null ? '—' : `${snapshot.battery.soc}%`} sublabel="SOC" accent={isDischarging ? 'var(--batt-discharge)' : 'var(--batt)'} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Stat label="Voltage" value={snapshot.battery.voltage.toFixed(1)} unit="V" />
              <Stat label="Current" value={Math.abs(snapshot.battery.current).toFixed(1)} unit="A" sub={isDischarging ? 'discharging' : snapshot.battery.current > 0 ? 'charging' : 'idle'} />
              <Stat label="Backup time" value={snapshot.battery.backupH?.toFixed(1) || '—'} unit="h" />
              <Stat label="Capacity" value={snapshot.battery.capacityAh.toLocaleString()} unit="Ah" />
            </div>
          </div>
          <CellAnomalyBadge banks={snapshot.banks} />
          {snapshot.banks ? <CellHeatmap banks={snapshot.banks} /> : (
            <div style={{ padding: 12, textAlign: 'center', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px dashed var(--border)' }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{snapshot.type === 'zte' ? 'ZTE legacy firmware — per-cell telemetry not exposed' : 'Aggregate battery — no per-cell data'}</span>
            </div>
          )}
        </section>

        <section>
          <div className="label-eyebrow" style={{ marginBottom: 10 }}>24 HOUR TRENDS</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <TrendRow label="AC Voltage" data={detailHistory.acV} accent="var(--grid-ok)" unit="V" />
            <TrendRow label="DC Load" data={detailHistory.dcLoad} accent="var(--dc)" unit="kW" decimals={2} />
            <TrendRow label="Battery SOC" data={detailHistory.soc} accent={isDischarging ? 'var(--batt-discharge)' : 'var(--batt)'} unit="%" />
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div className="label-eyebrow">24H ALARM TIMELINE</div>
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{alarms.filter(a => a.siteId === snapshot.id).length} events</span>
          </div>
          <AlarmTimeline events={alarms.filter(a => a.siteId === snapshot.id)} />
        </section>

        <section style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
            <div className="label-eyebrow">DEVICE METADATA</div>
            <SourceIndicator device={snapshot.device} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <span style={{ color: 'var(--text-dim)' }}>Vendor</span><span>{snapshot.device.vendor}</span>
            <span style={{ color: 'var(--text-dim)' }}>Model</span><span>{snapshot.device.model}</span>
            <span style={{ color: 'var(--text-dim)' }}>Endpoint</span><span>{snapshot.device.ip}:{snapshot.device.port}</span>
            <span style={{ color: 'var(--text-dim)' }}>Protocol</span><span>{snapshot.type === 'lithium' ? 'SNMP + Modbus' : snapshot.type === 'zte' ? 'SNMP (legacy)' : 'SNMP'}</span>
          </div>
          {!snapshot.maintenance && <button className="btn" onClick={() => onToggleMaintenance?.(snapshot.id)} style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>Enter Maintenance Mode</button>}
        </section>
      </div>
    </aside>
  );
}

function MobileSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: `rgba(4, 6, 10, ${0.6 - dragY / 800})`, backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="surface" onClick={event => event.stopPropagation()} style={{ width: '100%', maxHeight: '92vh', overflowY: 'auto', borderRadius: '20px 20px 0 0', padding: 0, transform: `translateY(${dragY}px)`, transition: dragY === 0 ? 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none', animation: dragY === 0 ? 'sheet-rise 280ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none' }}>
        <div
          onTouchStart={event => { startY.current = event.touches[0].clientY; }}
          onTouchMove={event => {
            if (startY.current == null) return;
            const dy = event.touches[0].clientY - startY.current;
            if (dy > 0) setDragY(dy);
          }}
          onTouchEnd={() => {
            if (dragY > 100) onClose();
            else setDragY(0);
            startY.current = null;
          }}
          style={{ padding: '10px 0 6px', display: 'flex', justifyContent: 'center', cursor: 'grab', touchAction: 'none' }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-strong)' }} />
        </div>
        {children}
      </div>
      <style>{`@keyframes sheet-rise { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="mono tnum live-clock" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{time.toLocaleTimeString('en-GB')} WIB</span>;
}

function AlarmPanel({ alarms, sites, onClose, onJumpSite }: { alarms: UiAlarm[]; sites: UiSnapshot[]; onClose: () => void; onJumpSite: (id: number) => void }) {
  const sevTone: Record<AlarmSeverity, string> = { critical: 'fail', warning: 'warn', info: 'ok' };
  return (
    <div className="modal-veil" onClick={onClose} style={{ alignItems: 'flex-start', paddingTop: 80 }}>
      <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 560 }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div className="label-eyebrow">ACTIVE ALARMS</div><h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>{alarms.length} active</h2></div>
          <button className="btn icon" onClick={onClose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          {alarms.length === 0 ? <div className="mono" style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>No active alarms</div> : alarms.map(alarm => {
            const site = sites.find(s => s.id === alarm.siteId);
            return (
              <button key={alarm.id} className="card" onClick={() => onJumpSite(alarm.siteId)} style={{ padding: 14, textAlign: 'left', color: 'inherit', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`tag ${sevTone[alarm.severity]}`}>{alarm.severity.toUpperCase()}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{alarm.code}</span>
                    </div>
                    <div style={{ fontWeight: 700, marginTop: 6, fontSize: 13 }}>{alarm.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{alarm.desc}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>{site?.name} · {alarm.since}</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-dim)', flexShrink: 0 }}><path d="M9 6l6 6-6 6" /></svg>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const telegramRules: Array<{ id: TelegramRuleId; title: string; desc: string }> = [
  { id: 'ac_fail', title: 'AC input failure', desc: 'Kirim saat grid/site mati lampu.' },
  { id: 'ac_restore', title: 'AC restored', desc: 'Kirim recovery saat grid kembali normal.' },
  { id: 'battery_discharge', title: 'Battery discharge', desc: 'Kirim saat load sedang ditopang battery.' },
  { id: 'low_soc', title: 'Low battery SOC', desc: 'Kirim saat SOC turun di bawah threshold.' },
  { id: 'low_backup', title: 'Low backup time', desc: 'Kirim saat estimasi backup time pendek.' },
  { id: 'stale_data', title: 'No recent data', desc: 'Kirim saat data polling sudah terlalu lama.' },
];

function TelegramPanel({
  settings,
  alarms,
  sites,
  telegramStatus,
  telegramTestToken,
  telegramTesting,
  telegramTestResult,
  onClose,
  onChange,
  onTelegramTestTokenChange,
  onTestTelegram,
}: {
  settings: TelegramSettings;
  alarms: UiAlarm[];
  sites: UiSnapshot[];
  telegramStatus: TelegramStatus | null;
  telegramTestToken: string;
  telegramTesting: boolean;
  telegramTestResult: TelegramTestResult | null;
  onClose: () => void;
  onChange: (settings: TelegramSettings) => void;
  onTelegramTestTokenChange: (token: string) => void;
  onTestTelegram: () => void;
}) {
  const activeSites = sites.filter(site => site.ac.status === 'fail' || site.battery.status === 'DISCHARGING' || site.battery.status === 'discharging');
  const previewAlarm = alarms[0];
  const previewSite = previewAlarm ? sites.find(site => site.id === previewAlarm.siteId) : activeSites[0];
  const hasTelegramToken = Boolean(telegramStatus?.configured || telegramTestToken.trim());
  const hasTelegramTarget = Boolean(settings.chatId.trim() || telegramStatus?.defaultChatIdConfigured);
  const telegramReady = settings.enabled && hasTelegramToken && hasTelegramTarget;
  const telegramStatusLabel = !settings.enabled
    ? 'Disabled'
    : (!hasTelegramTarget ? 'Needs chat ID' : (!hasTelegramToken ? 'Needs token' : 'Ready to test'));
  const sampleMessage = previewSite
    ? [
        `[NEN] ${previewSite.name}`,
        previewAlarm ? `${previewAlarm.code}: ${previewAlarm.title}` : 'STATUS: Electrical event',
        `AC: ${previewSite.ac.status === 'fail' ? 'FAIL' : 'NORMAL'} · ${previewSite.ac.l1 || 0}V`,
        `DC Load: ${previewSite.dc.totalKw?.toFixed(2) || '--'} kW`,
        `Battery: ${previewSite.battery.soc ?? '--'}% · ${previewSite.battery.backupH ?? '--'}h backup`,
      ].join('\n')
    : '[NEN] No active event\nAll monitored POPs are clear.';

  const update = <K extends keyof TelegramSettings>(key: K, value: TelegramSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const updateRule = (rule: TelegramRuleId, enabled: boolean) => {
    onChange({ ...settings, rules: { ...settings.rules, [rule]: enabled } });
  };

  return (
    <div className="modal-veil" onClick={onClose} style={{ alignItems: 'flex-start', paddingTop: 64 }}>
      <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 920 }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
          <div>
            <div className="label-eyebrow">TELEGRAM ALERTS</div>
            <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>Push Notification Menu</h2>
          </div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close Telegram panel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)', gap: 16 }} className="telegram-layout">
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="surface-2" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div className="label-eyebrow">CHANNEL</div>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>Telegram target</div>
                </div>
                <button
                  type="button"
                  className={`btn ${settings.enabled ? 'primary' : ''}`}
                  onClick={() => update('enabled', !settings.enabled)}
                  style={{ minWidth: 104, justifyContent: 'center' }}
                >
                  {settings.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }} className="telegram-fields">
                <label style={{ display: 'grid', gap: 6 }}>
                  <span className="label-eyebrow">Name</span>
                  <input className="mono" value={settings.channelName} onChange={event => update('channelName', event.target.value)} placeholder="NEN Operations" />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span className="label-eyebrow">Chat ID</span>
                  <input className="mono" value={settings.chatId} onChange={event => update('chatId', event.target.value)} placeholder="-100xxxxxxxxxx" />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span className="label-eyebrow">Topic ID</span>
                  <input className="mono" value={settings.threadId} onChange={event => update('threadId', event.target.value)} placeholder="Optional" />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span className="label-eyebrow">Cooldown</span>
                  <input className="mono" type="number" min={1} max={240} value={settings.cooldownMin} onChange={event => update('cooldownMin', Number(event.target.value) || 15)} />
                </label>
              </div>
              <div className="mono" style={{ marginTop: 12, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                Bot token tidak disimpan di browser. Pakai server environment untuk permanen, atau one-time token hanya untuk tombol test.
              </div>
            </div>

            <div className="surface-2" style={{ padding: 14 }}>
              <div className="label-eyebrow">RULES</div>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {telegramRules.map(rule => (
                  <label key={rule.id} className="telegram-rule">
                    <input type="checkbox" checked={settings.rules[rule.id]} onChange={event => updateRule(rule.id, event.target.checked)} />
                    <span>
                      <strong>{rule.title}</strong>
                      <small>{rule.desc}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="surface-2" style={{ padding: 14 }}>
              <div className="label-eyebrow">THRESHOLDS</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }} className="telegram-fields">
                <label style={{ display: 'grid', gap: 6 }}>
                  <span className="label-eyebrow">Min SOC (%)</span>
                  <input className="mono" type="number" min={1} max={100} value={settings.minSoc} onChange={event => update('minSoc', Number(event.target.value) || 30)} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span className="label-eyebrow">Min Backup (h)</span>
                  <input className="mono" type="number" min={0.1} step={0.1} value={settings.minBackupH} onChange={event => update('minBackupH', Number(event.target.value) || 2)} />
                </label>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <div className="surface-2" style={{ padding: 14 }}>
              <div className="label-eyebrow">STATUS</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                <div className="telegram-stat">
                  <span>Active rules</span>
                  <strong>{Object.values(settings.rules).filter(Boolean).length}</strong>
                </div>
                <div className="telegram-stat">
                  <span>Server token</span>
                  <strong>{telegramStatus?.configured ? 'OK' : '—'}</strong>
                </div>
              </div>
              <div className={`tag ${telegramReady ? 'ok' : 'warn'}`} style={{ marginTop: 12 }}>
                {telegramStatusLabel}
              </div>
            </div>

            <div className="surface-2" style={{ padding: 14 }}>
              <div className="label-eyebrow">TEST SEND</div>
              <div className="mono" style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Jika server belum punya TELEGRAM_BOT_TOKEN, isi token sekali pakai di bawah. Token ini tidak masuk localStorage.
              </div>
              <label style={{ display: 'grid', gap: 6, marginTop: 12 }}>
                <span className="label-eyebrow">One-time bot token</span>
                <input
                  className="mono"
                  type="password"
                  value={telegramTestToken}
                  onChange={event => onTelegramTestTokenChange(event.target.value)}
                  placeholder={telegramStatus?.configured ? 'Server token configured' : '123456:ABC-DEF...'}
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={telegramTesting || !hasTelegramTarget || !hasTelegramToken}
                onClick={onTestTelegram}
                style={{ marginTop: 12, width: '100%', justifyContent: 'center', opacity: telegramTesting || !hasTelegramTarget || !hasTelegramToken ? 0.55 : 1 }}
              >
                {telegramTesting ? 'Sending...' : 'Test Telegram'}
              </button>
              {telegramTestResult && (
                <div className={`tag ${telegramTestResult.ok ? 'ok' : 'fail'}`} style={{ marginTop: 10, width: '100%', justifyContent: 'center', whiteSpace: 'normal', textAlign: 'center' }}>
                  {telegramTestResult.message}
                </div>
              )}
            </div>

            <div className="surface-2" style={{ padding: 14 }}>
              <div className="label-eyebrow">MESSAGE PREVIEW</div>
              <pre className="telegram-preview">{sampleMessage}</pre>
            </div>

            <div className="surface-2" style={{ padding: 14 }}>
              <div className="label-eyebrow">NEXT BACKEND STEP</div>
              <div className="mono" style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                Test send sudah via backend. Tahap berikutnya adalah simpan channels/rules di DB, lalu evaluator server mengirim alert otomatis dengan cooldown dan recovery.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const settingsSections: Array<{ id: SettingsSection; label: string; desc: string }> = [
  { id: 'general', label: 'General', desc: 'Theme and dashboard behavior' },
  { id: 'notifications', label: 'Notifications', desc: 'Telegram alerts and thresholds' },
  { id: 'nodes', label: 'Nodes', desc: 'POP view and registration shortcuts' },
  { id: 'runtime', label: 'Runtime', desc: 'Local API and polling context' },
  { id: 'about', label: 'About', desc: 'Project identity and system notes' },
];

function SettingsPanel({
  openSection,
  onSectionChange,
  theme,
  onThemeChange,
  siteViewMode,
  onSiteViewModeChange,
  telegramSettings,
  telegramStatus,
  telegramTestToken,
  telegramTesting,
  telegramTestResult,
  onTelegramChange,
  onTelegramTestTokenChange,
  onTestTelegram,
  onOpenTelegram,
  onOpenAddSite,
  onClose,
  sites,
  alarms,
}: {
  openSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  siteViewMode: SiteViewMode;
  onSiteViewModeChange: (mode: SiteViewMode) => void;
  telegramSettings: TelegramSettings;
  telegramStatus: TelegramStatus | null;
  telegramTestToken: string;
  telegramTesting: boolean;
  telegramTestResult: TelegramTestResult | null;
  onTelegramChange: (settings: TelegramSettings) => void;
  onTelegramTestTokenChange: (token: string) => void;
  onTestTelegram: () => void;
  onOpenTelegram: () => void;
  onOpenAddSite: () => void;
  onClose: () => void;
  sites: UiSnapshot[];
  alarms: UiAlarm[];
}) {
  const updateTelegram = <K extends keyof TelegramSettings>(key: K, value: TelegramSettings[K]) => {
    onTelegramChange({ ...telegramSettings, [key]: value });
  };
  const updateTelegramRule = (rule: TelegramRuleId, enabled: boolean) => {
    onTelegramChange({ ...telegramSettings, rules: { ...telegramSettings.rules, [rule]: enabled } });
  };
  const activeTelegramRules = Object.values(telegramSettings.rules).filter(Boolean).length;
  const hasTelegramToken = Boolean(telegramStatus?.configured || telegramTestToken.trim());
  const hasTelegramTarget = Boolean(telegramSettings.chatId.trim() || telegramStatus?.defaultChatIdConfigured);
  const telegramReady = telegramSettings.enabled && hasTelegramToken && hasTelegramTarget;
  const telegramStatusLabel = !telegramSettings.enabled
    ? 'Disabled'
    : (!hasTelegramTarget ? 'Needs chat ID' : (!hasTelegramToken ? 'Needs token' : 'Ready to test'));

  return (
    <div className="modal-veil" onClick={onClose} style={{ alignItems: 'flex-start', paddingTop: 56 }}>
      <div className="modal settings-modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 1040 }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
          <div>
            <div className="label-eyebrow">SYSTEM SETTINGS</div>
            <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>NEN Dashboard</h2>
          </div>
          <button type="button" className="btn icon" onClick={onClose} aria-label="Close settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="settings-layout">
          <aside className="settings-nav">
            {settingsSections.map(section => (
              <button
                key={section.id}
                type="button"
                className={`settings-nav-item ${openSection === section.id ? 'active' : ''}`}
                onClick={() => onSectionChange(section.id)}
              >
                <strong>{section.label}</strong>
                <small>{section.desc}</small>
              </button>
            ))}
          </aside>

          <section className="settings-content">
            {openSection === 'general' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">APPEARANCE</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>Theme</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Stored as nen_design_theme</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className={`btn ${theme === 'dark' ? 'primary' : ''}`} onClick={() => onThemeChange('dark')}>Dark</button>
                      <button type="button" className={`btn ${theme === 'light' ? 'primary' : ''}`} onClick={() => onThemeChange('light')}>Light</button>
                    </div>
                  </div>
                </div>

                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">DASHBOARD DEFAULTS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
                    <div className="telegram-stat"><span>Poll interval</span><strong>{Math.round(POLL_INTERVAL_MS / 1000)}s</strong></div>
                    <div className="telegram-stat"><span>Sites loaded</span><strong>{sites.length}</strong></div>
                    <div className="telegram-stat"><span>Alarms active</span><strong>{alarms.length}</strong></div>
                  </div>
                </div>
              </div>
            )}

            {openSection === 'notifications' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div className="surface-2" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div className="label-eyebrow">TELEGRAM</div>
                      <div style={{ fontWeight: 700, marginTop: 4 }}>Push notification</div>
                    </div>
                    <button type="button" className={`btn ${telegramSettings.enabled ? 'primary' : ''}`} onClick={() => updateTelegram('enabled', !telegramSettings.enabled)}>
                      {telegramSettings.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }} className="telegram-fields">
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="label-eyebrow">Chat ID</span>
                      <input className="mono" value={telegramSettings.chatId} onChange={event => updateTelegram('chatId', event.target.value)} placeholder="-100xxxxxxxxxx" />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="label-eyebrow">Topic ID</span>
                      <input className="mono" value={telegramSettings.threadId} onChange={event => updateTelegram('threadId', event.target.value)} placeholder="Optional" />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="label-eyebrow">Cooldown (min)</span>
                      <input className="mono" type="number" min={1} value={telegramSettings.cooldownMin} onChange={event => updateTelegram('cooldownMin', Number(event.target.value) || 15)} />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="label-eyebrow">One-time token</span>
                      <input
                        className="mono"
                        type="password"
                        value={telegramTestToken}
                        onChange={event => onTelegramTestTokenChange(event.target.value)}
                        placeholder={telegramStatus?.configured ? 'Server token configured' : 'For test only'}
                        autoComplete="off"
                      />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <span className={`tag ${telegramReady ? 'ok' : 'warn'}`}>
                      {telegramStatusLabel}
                    </span>
                    <span className="tag">{activeTelegramRules} rules</span>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={telegramTesting || !hasTelegramTarget || !hasTelegramToken}
                      onClick={onTestTelegram}
                      style={{ marginLeft: 'auto', opacity: telegramTesting || !hasTelegramTarget || !hasTelegramToken ? 0.55 : 1 }}
                    >
                      {telegramTesting ? 'Sending...' : 'Test Telegram'}
                    </button>
                    <button type="button" className="btn" onClick={onOpenTelegram}>Advanced</button>
                  </div>
                  {telegramTestResult && (
                    <div className={`tag ${telegramTestResult.ok ? 'ok' : 'fail'}`} style={{ marginTop: 10, width: '100%', justifyContent: 'center', whiteSpace: 'normal', textAlign: 'center' }}>
                      {telegramTestResult.message}
                    </div>
                  )}
                  <div className="mono" style={{ marginTop: 10, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    Token test tidak disimpan di localStorage. Untuk permanen, set TELEGRAM_BOT_TOKEN di server environment.
                  </div>
                </div>

                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">ACTIVE RULES</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 12 }}>
                    {telegramRules.map(rule => (
                      <label key={rule.id} className="telegram-rule">
                        <input type="checkbox" checked={telegramSettings.rules[rule.id]} onChange={event => updateTelegramRule(rule.id, event.target.checked)} />
                        <span><strong>{rule.title}</strong><small>{rule.desc}</small></span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {openSection === 'nodes' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">NODE VIEW</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>Network node layout</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Grid for visual cards, list for dense operations.</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className={`btn ${siteViewMode === 'grid' ? 'primary' : ''}`} onClick={() => onSiteViewModeChange('grid')}>Grid</button>
                      <button type="button" className={`btn ${siteViewMode === 'list' ? 'primary' : ''}`} onClick={() => onSiteViewModeChange('list')}>List</button>
                    </div>
                  </div>
                </div>
                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">REGISTRATION</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>Add POP workflow</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>SNMP probe is required before saving.</div>
                    </div>
                    <button type="button" className="btn primary" onClick={onOpenAddSite}>Add POP</button>
                  </div>
                </div>
              </div>
            )}

            {openSection === 'runtime' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">LOCAL RUNTIME</div>
                  <div className="settings-kv" style={{ marginTop: 12 }}>
                    <span>Frontend</span><strong>localhost:3002</strong>
                    <span>API base</span><strong>{API_BASE_URL}</strong>
                    <span>Metrics source</span><strong>latest_metrics</strong>
                    <span>Modbus UI sites</span><strong>{MODBUS_SITE_IDS.length ? MODBUS_SITE_IDS.join(', ') : 'disabled'}</strong>
                  </div>
                </div>
                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">PRODUCTION SAFETY</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, marginTop: 8 }}>
                    Settings ini berjalan lokal. Upload/deploy/restart production tetap wajib menunggu perintah eksplisit di turn yang sama.
                  </div>
                </div>
              </div>
            )}

            {openSection === 'about' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div className="surface-2 about-hero" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div className="nen-mark" style={{ width: 44, height: 44, borderRadius: 12 }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" fillOpacity="0.3" /></svg>
                    </div>
                    <div>
                      <div className="label-eyebrow">NETWORK ELECTRICITY NODE</div>
                      <h3 style={{ margin: '4px 0 0', fontSize: 22, lineHeight: 1.1 }}>NEN Dashboard</h3>
                      <div className="mono" style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>Rectifier · AC input · DC load · battery bank monitoring</div>
                    </div>
                  </div>
                </div>

                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">ABOUT US</div>
                  <p style={{ margin: '10px 0 0', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    NEN is a local-first monitoring dashboard for Aneka POP electrical infrastructure. It consolidates multi-vendor SNMP telemetry from Huawei and ZTE power systems into one realtime operational view, so grid state, DC load, battery health, backup time, and site alarms can be checked quickly from desktop or mobile.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <div className="telegram-stat"><span>Monitored POPs</span><strong>{sites.length}</strong></div>
                  <div className="telegram-stat"><span>Telemetry path</span><strong>SNMP</strong></div>
                  <div className="telegram-stat"><span>Realtime table</span><strong>latest</strong></div>
                </div>

                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">SYSTEM PRINCIPLES</div>
                  <div className="about-list" style={{ marginTop: 12 }}>
                    <div>
                      <strong>Production-safe</strong>
                      <span>Live deployment and remote restarts only happen after explicit command.</span>
                    </div>
                    <div>
                      <strong>Vendor-aware</strong>
                      <span>Huawei lithium, Huawei standard, and ZTE nodes keep their own validated scale factors and mappings.</span>
                    </div>
                    <div>
                      <strong>Ops-focused</strong>
                      <span>Dashboard surfaces AC failure, battery discharge, stale data, and low reserve conditions first.</span>
                    </div>
                  </div>
                </div>

                <div className="surface-2" style={{ padding: 14 }}>
                  <div className="label-eyebrow">BUILD NOTES</div>
                  <div className="settings-kv" style={{ marginTop: 12 }}>
                    <span>Frontend</span><strong>React + Vite</strong>
                    <span>Server</span><strong>Express + PostgreSQL</strong>
                    <span>Agent</span><strong>Node.js SNMP polling</strong>
                    <span>Auth</span><strong>Bearer token protected API</strong>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ResponsiveCSS() {
  return <style>{`
    @media (max-width: 1199px) {
      .layout { grid-template-columns: 1fr !important; }
      .detail-panel { display: none !important; }
      .telegram-layout { grid-template-columns: 1fr !important; }
      .settings-layout { grid-template-columns: 1fr !important; }
      .settings-nav { grid-template-columns: repeat(5, minmax(130px, 1fr)) !important; overflow-x: auto; }
    }
    @media (max-width: 700px) {
      .site-grid { grid-template-columns: 1fr !important; }
      .telegram-fields { grid-template-columns: 1fr !important; }
      .settings-nav { grid-template-columns: repeat(5, minmax(120px, 1fr)) !important; }
    }
  `}</style>;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('nen_token') || '');
  const [password, setPassword] = useState('');
  const [theme, setTheme] = useState<ThemeName>((localStorage.getItem('nen_design_theme') as ThemeName) || 'dark');
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState(1);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [alarmPanelOpen, setAlarmPanelOpen] = useState(false);
  const [telegramPanelOpen, setTelegramPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [siteModalOpen, setSiteModalOpen] = useState(false);
  const [siteViewMode, setSiteViewMode] = useState<SiteViewMode>('grid');
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings>(loadTelegramSettings);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramTestToken, setTelegramTestToken] = useState('');
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<TelegramTestResult | null>(null);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteIp, setNewSiteIp] = useState('');
  const [newSiteLocation, setNewSiteLocation] = useState('');
  const [newSiteType, setNewSiteType] = useState<SiteFormType>('lithium');
  const [newSitePort, setNewSitePort] = useState('161');
  const [newSiteCommunity, setNewSiteCommunity] = useState('Anekanet');
  const [siteProbe, setSiteProbe] = useState<ProbeResult | null>(null);
  const [siteProbeLoading, setSiteProbeLoading] = useState(false);
  const [siteProbeKey, setSiteProbeKey] = useState('');
  const [historyRows, setHistoryRows] = useState<Metric[]>([]);
  const [maintenance, setMaintenance] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    const accent = ACCENT_PRESETS.emerald[theme];
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--grid-ok', accent);
    root.style.setProperty('--grid-ok-bg', `color-mix(in oklab, ${accent}, transparent 88%)`);
    localStorage.setItem('nen_design_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!token) return;
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    fetchData();
    const interval = window.setInterval(fetchMetrics, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [token]);

  useEffect(() => {
    localStorage.setItem(TELEGRAM_STORAGE_KEY, JSON.stringify(telegramSettings));
  }, [telegramSettings]);

  const snapshots = useMemo(() => mapSnapshots(sites, metrics, devices, maintenance), [sites, metrics, devices, maintenance]);
  const alarms = useMemo(() => buildAlarms(snapshots), [snapshots]);
  const selected = snapshots.find(site => site.id === selectedId) || snapshots[0];
  const siteProbeValid = Boolean(siteProbe?.canSave && siteProbeKey === [newSiteIp.trim(), newSitePort.trim(), newSiteCommunity.trim(), newSiteType].join('|'));
  const apiHistory = useMemo(() => buildHistoryFromRows(historyRows), [historyRows]);
  const historyBySite = useMemo(() => {
    const out: Record<number, UiHistory> = {};
    snapshots.forEach(site => { out[site.id] = site.id === selected?.id && historyRows.length ? apiHistory : syntheticHistory(site); });
    return out;
  }, [snapshots, selected?.id, historyRows, apiHistory]);

  useEffect(() => {
    if (snapshots.length && !snapshots.some(site => site.id === selectedId)) setSelectedId(snapshots[0].id);
  }, [snapshots, selectedId]);

  useEffect(() => {
    if (selected?.id) fetchHistory(selected.id);
  }, [selected?.id]);

  const handleAuthError = (error: any) => {
    if (error.response?.status === 401) {
      setToken('');
      localStorage.removeItem('nen_token');
    }
  };

  const fetchConfig = async () => {
    try {
      const [sitesRes, devicesRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/sites`),
        axios.get(`${API_BASE_URL}/api/devices`),
      ]);
      setSites(sitesRes.data);
      setDevices(devicesRes.data);
      setMaintenance(current => {
        const next = { ...current };
        sitesRes.data.forEach((site: Site) => {
          if (next[site.id] == null) next[site.id] = false;
        });
        return next;
      });
    } catch (error) {
      handleAuthError(error);
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/metrics/latest`);
      setMetrics(res.data);
    } catch (error) {
      handleAuthError(error);
    }
  };

  const fetchTelegramStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/alerts/telegram/status`);
      setTelegramStatus(res.data);
    } catch (error) {
      handleAuthError(error);
    }
  };

  const fetchData = async () => Promise.all([fetchConfig(), fetchMetrics(), fetchTelegramStatus()]);

  const fetchHistory = async (siteId: number) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/metrics/history?siteId=${siteId}`);
      setHistoryRows(res.data);
    } catch {
      setHistoryRows([]);
    }
  };

  const currentProbeKey = () => [newSiteIp.trim(), newSitePort.trim(), newSiteCommunity.trim(), newSiteType].join('|');

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const res = await axios.post(`${API_BASE_URL}/api/login`, { password });
      setToken(res.data.token);
      localStorage.setItem('nen_token', res.data.token);
    } catch {
      alert('Login failed: Invalid password (hint: admin)');
    }
  };

  const handleAddSite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!siteProbe?.canSave || siteProbeKey !== currentProbeKey()) {
      alert('Run Test SNMP successfully before saving this POP.');
      return;
    }
    try {
      await axios.post(`${API_BASE_URL}/api/sites`, {
        name: newSiteName,
        location: newSiteLocation || 'Unknown',
        siteType: newSiteType,
        ip: newSiteIp,
        port: Number(newSitePort) || 161,
        community: newSiteCommunity || (newSiteType === 'zte' ? 'public' : 'Anekanet'),
        deviceType: newSiteType === 'zte' ? 'zte_power' : 'huawei_enspire',
        deviceName: newSiteType === 'zte' ? 'ZTE ZXDU68' : newSiteType === 'standard' ? 'Standard SMU' : 'Lithium SMU',
      });
      setNewSiteName('');
      setNewSiteIp('');
      setNewSiteLocation('');
      setNewSiteType('lithium');
      setNewSitePort('161');
      setNewSiteCommunity('Anekanet');
      setSiteProbe(null);
      setSiteProbeKey('');
      setSiteModalOpen(false);
      fetchData();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to add site');
    }
  };

  const handleProbeSite = async () => {
    setSiteProbeLoading(true);
    setSiteProbe(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/sites/probe`, {
        ip: newSiteIp,
        port: Number(newSitePort) || 161,
        community: newSiteCommunity || (newSiteType === 'zte' ? 'public' : 'Anekanet'),
        siteType: newSiteType,
      });
      const probe = res.data as ProbeResult;
      const detectedType = probe.suggestedSiteType || newSiteType;
      setSiteProbe(probe);
      setSiteProbeKey([newSiteIp.trim(), newSitePort.trim(), (newSiteCommunity || (detectedType === 'zte' ? 'public' : 'Anekanet')).trim(), detectedType].join('|'));
      if (detectedType !== newSiteType) {
        setNewSiteType(detectedType);
      }
    } catch (error: any) {
      setSiteProbe({
        reachable: false,
        vendor: null,
        suggestedSiteType: newSiteType,
        sysDescr: null,
        canSave: false,
      });
      alert(error.response?.data?.error || 'SNMP probe failed');
    } finally {
      setSiteProbeLoading(false);
    }
  };

  const handleTestTelegram = async () => {
    setTelegramTesting(true);
    setTelegramTestResult(null);
    const primaryAlarm = alarms[0];
    const alarmSite = primaryAlarm ? snapshots.find(site => site.id === primaryAlarm.siteId) : selected;
    const message = [
      '[NEN] Telegram test',
      alarmSite ? `POP: ${alarmSite.name}` : `POPs: ${snapshots.length}`,
      primaryAlarm ? `Alarm: ${primaryAlarm.code} - ${primaryAlarm.title}` : 'Alarm: test channel only',
      alarmSite ? `AC: ${alarmSite.ac.status.toUpperCase()} · ${alarmSite.ac.l1 || 0}V` : undefined,
      alarmSite ? `DC Load: ${alarmSite.dc.totalKw?.toFixed(2) || '--'} kW` : undefined,
      alarmSite ? `Battery: ${alarmSite.battery.soc ?? '--'}% · ${alarmSite.battery.backupH ?? '--'}h backup` : undefined,
      `Sent: ${new Date().toLocaleString('id-ID')} WIB`,
    ].filter(Boolean).join('\n');

    try {
      const res = await axios.post(`${API_BASE_URL}/api/alerts/telegram/test`, {
        chatId: telegramSettings.chatId,
        threadId: telegramSettings.threadId,
        botToken: telegramTestToken,
        message,
      });
      setTelegramTestResult({ ok: true, message: res.data?.message || 'Telegram test sent' });
      fetchTelegramStatus();
    } catch (error: any) {
      setTelegramTestResult({
        ok: false,
        message: error.response?.data?.error || error.response?.data?.description || 'Telegram test failed',
      });
    } finally {
      setTelegramTesting(false);
    }
  };

  const handleSelectSite = (id: number) => {
    setSelectedId(id);
    if (window.matchMedia('(max-width: 1199px)').matches) setMobileDetailOpen(true);
  };

  if (!token) {
    return (
      <div className="app-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <form className="card" onSubmit={handleLogin} style={{ width: '100%', maxWidth: 360, padding: 24 }}>
          <div className="nen-mark" style={{ margin: '0 auto 16px', width: 48, height: 48 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" fillOpacity="0.3" /></svg>
          </div>
          <div className="label-eyebrow" style={{ textAlign: 'center' }}>NEN · SECURE ACCESS</div>
          <input value={password} onChange={event => setPassword(event.target.value)} type="password" placeholder="Passphrase" required className="mono" style={{ marginTop: 18, width: '100%', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 'var(--r-md)', padding: '12px 14px', textAlign: 'center', outline: 'none' }} />
          <button className="btn primary" type="submit" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}>Authenticate</button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-bg" style={{ minHeight: '100vh' }}>
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 40, background: 'color-mix(in oklab, var(--bg), transparent 8%)', backdropFilter: 'blur(20px) saturate(120%)', borderBottom: '1px solid var(--border)' }}>
        <div className="app-header-inner" style={{ maxWidth: 1600, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="nen-mark app-brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" fillOpacity="0.3" /></svg>
          </div>
          <div className="app-brand-copy" style={{ flex: 1, minWidth: 0 }}>
            <div className="app-brand-title" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', color: 'var(--text-muted)' }}>
              NEN <span className="brand-long">· NETWORK ELECTRICITY NODE</span>
            </div>
            <div className="app-brand-meta" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
              <span className="dot ok" />
              <span className="mono app-live-meta" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Live · {snapshots.length} POPs · polling {Math.round(POLL_INTERVAL_MS / 1000)}s</span>
              <span className="meta-separator" style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--text-faint)' }} />
              <LiveClock />
            </div>
          </div>
          <div className="app-header-actions">
            <button className="btn app-header-btn" onClick={() => setAlarmPanelOpen(true)} style={{ position: 'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" /></svg>
              Alarms
              {alarms.length > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--grid-fail)', color: 'white', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, minWidth: 16, textAlign: 'center' }}>{alarms.length}</span>}
            </button>
            <button className="btn app-header-btn" onClick={() => setSettingsPanelOpen(true)} style={{ position: 'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z" /></svg>
              Settings
              {telegramSettings.enabled && <span className="dot ok" style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6 }} />}
            </button>
            <button className="btn icon app-header-btn theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
              {theme === 'dark'
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>}
            </button>
          </div>
        </div>
      </header>

      <main className="app-main" style={{ maxWidth: 1600, margin: '0 auto', padding: 24 }}>
        <SummaryStrip sites={snapshots} alarms={alarms} />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 480px)', gap: 20, marginTop: 20 }} className="layout">
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="label-eyebrow" style={{ fontSize: 11 }}>NETWORK NODES</span>
                <span className="tag">{snapshots.length}</span>
              </h2>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" style={{ padding: '6px 10px' }} onClick={() => setSiteViewMode(siteViewMode === 'grid' ? 'list' : 'grid')}>
                  {siteViewMode === 'grid'
                    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
                    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>}
                  {siteViewMode === 'grid' ? 'List' : 'Grid'}
                </button>
                <button className="btn" style={{ padding: '6px 10px' }} onClick={() => setSiteModalOpen(true)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>Add POP</button>
              </div>
            </div>
            {siteViewMode === 'grid' ? (
              <div className="site-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
                {snapshots.map(snapshot => (
                  <SiteCard key={snapshot.id} snapshot={snapshot} selected={snapshot.id === selected?.id} onSelect={() => handleSelectSite(snapshot.id)} history={historyBySite[snapshot.id] || syntheticHistory(snapshot)} alarms={alarms} density="normal" />
                ))}
              </div>
            ) : (
              <SiteList sites={snapshots} selectedId={selected?.id} onSelect={handleSelectSite} />
            )}
          </div>
          <div className="detail-panel" style={{ minWidth: 0, position: 'sticky', top: 84, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
            <SiteDetail snapshot={selected} history={selected ? historyBySite[selected.id] : undefined} alarms={alarms} onToggleMaintenance={id => setMaintenance(current => ({ ...current, [id]: !current[id] }))} />
          </div>
        </div>
      </main>

      <MobileSheet open={mobileDetailOpen && !!selected} onClose={() => setMobileDetailOpen(false)}>
        {selected && <SiteDetail snapshot={selected} history={historyBySite[selected.id]} alarms={alarms} onClose={() => setMobileDetailOpen(false)} onToggleMaintenance={id => setMaintenance(current => ({ ...current, [id]: !current[id] }))} />}
      </MobileSheet>

      {alarmPanelOpen && <AlarmPanel alarms={alarms} sites={snapshots} onClose={() => setAlarmPanelOpen(false)} onJumpSite={id => { setSelectedId(id); setAlarmPanelOpen(false); }} />}

      {telegramPanelOpen && (
        <TelegramPanel
          settings={telegramSettings}
          alarms={alarms}
          sites={snapshots}
          telegramStatus={telegramStatus}
          telegramTestToken={telegramTestToken}
          telegramTesting={telegramTesting}
          telegramTestResult={telegramTestResult}
          onClose={() => setTelegramPanelOpen(false)}
          onChange={setTelegramSettings}
          onTelegramTestTokenChange={setTelegramTestToken}
          onTestTelegram={handleTestTelegram}
        />
      )}

      {settingsPanelOpen && (
        <SettingsPanel
          openSection={settingsSection}
          onSectionChange={setSettingsSection}
          theme={theme}
          onThemeChange={setTheme}
          siteViewMode={siteViewMode}
          onSiteViewModeChange={setSiteViewMode}
          telegramSettings={telegramSettings}
          telegramStatus={telegramStatus}
          telegramTestToken={telegramTestToken}
          telegramTesting={telegramTesting}
          telegramTestResult={telegramTestResult}
          onTelegramChange={setTelegramSettings}
          onTelegramTestTokenChange={setTelegramTestToken}
          onTestTelegram={handleTestTelegram}
          onOpenTelegram={() => {
            setSettingsPanelOpen(false);
            setTelegramPanelOpen(true);
          }}
          onOpenAddSite={() => {
            setSettingsPanelOpen(false);
            setSiteModalOpen(true);
          }}
          onClose={() => setSettingsPanelOpen(false)}
          sites={snapshots}
          alarms={alarms}
        />
      )}

      {siteModalOpen && (
        <div className="modal-veil" onClick={() => setSiteModalOpen(false)}>
          <form className="modal" onSubmit={handleAddSite} onClick={event => event.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ padding: 20, borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div className="label-eyebrow">REGISTER NEW POP</div><h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>Network Link</h2></div>
              <button type="button" className="btn icon" onClick={() => setSiteModalOpen(false)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
            <div style={{ padding: 20, display: 'grid', gap: 12 }}>
              <input className="mono" value={newSiteName} onChange={event => setNewSiteName(event.target.value)} placeholder="Site name" required style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 'var(--r-md)', padding: '12px 14px', outline: 'none' }} />
              <input className="mono" value={newSiteLocation} onChange={event => setNewSiteLocation(event.target.value)} placeholder="Location" style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 'var(--r-md)', padding: '12px 14px', outline: 'none' }} />
              <input className="mono" value={newSiteIp} onChange={event => setNewSiteIp(event.target.value)} placeholder="Node IP address" required style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 'var(--r-md)', padding: '12px 14px', outline: 'none' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
                <select
                  className="mono"
                  value={newSiteType}
                  onChange={event => {
                    const next = event.target.value as 'lithium' | 'standard' | 'zte';
                    setNewSiteType(next);
                    setNewSiteCommunity(next === 'zte' ? 'public' : 'Anekanet');
                  }}
                  style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 'var(--r-md)', padding: '12px 14px', outline: 'none' }}
                >
                  <option value="lithium">Huawei Lithium</option>
                  <option value="standard">Huawei Standard</option>
                  <option value="zte">ZTE ZXDU68</option>
                </select>
                <input className="mono" value={newSitePort} onChange={event => setNewSitePort(event.target.value)} placeholder="Port" inputMode="numeric" style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 'var(--r-md)', padding: '12px 14px', outline: 'none' }} />
              </div>
              <input className="mono" value={newSiteCommunity} onChange={event => setNewSiteCommunity(event.target.value)} placeholder="SNMP community" required style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', borderRadius: 'var(--r-md)', padding: '12px 14px', outline: 'none' }} />
              <button className="btn" type="button" onClick={handleProbeSite} disabled={!newSiteIp || siteProbeLoading} style={{ justifyContent: 'center' }}>
                {siteProbeLoading ? 'Testing SNMP...' : 'Test SNMP'}
              </button>
              {siteProbe && (
                <div className="surface-2" style={{ padding: 12, border: `1px solid ${siteProbeValid ? 'var(--grid-ok)' : 'var(--grid-fail)'}` }}>
                  <div className="label-eyebrow" style={{ color: siteProbeValid ? 'var(--grid-ok)' : 'var(--grid-fail)' }}>
                    {siteProbeValid ? 'SNMP OK' : 'SNMP CHECK FAILED'}
                  </div>
                  <div className="mono" style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    Vendor: {siteProbe.vendor || 'unknown'} · Type: {siteProbe.suggestedSiteType || newSiteType}<br />
                    {siteProbe.sysDescr || 'No sysDescr response'}
                  </div>
                </div>
              )}
              <button className="btn primary" type="submit" disabled={!siteProbeValid} style={{ justifyContent: 'center', opacity: siteProbeValid ? 1 : 0.55 }}>Save POP</button>
            </div>
          </form>
        </div>
      )}

      <ResponsiveCSS />
    </div>
  );
}

export default App;
