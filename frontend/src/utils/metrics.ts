import type { Device, Metric, Site } from '../types';

export interface SiteSnapshot {
  site: Site;
  device?: Device;
  ac?: Metric;
  batteries: Metric[];
  rectifiers: Metric[];
  lastUpdated: string | null;
  isAcFailure: boolean;
  primaryAcVoltage: number;
  acApparentPower: number | null;
  acPowerFactor: number | null;
  estimatedPowerFactor: number | null;
  systemVoltage: number;
  totalBatteryCurrent: number;
  totalBatteryPower: number;
  totalDcLoadWatts: number | null;
  totalDcLoadAmps: number | null;
  isGridSupplyingLoad: boolean;
  isBatteryDischarging: boolean;
  isBatteryCharging: boolean;
  powerFlowState: 'grid' | 'battery' | 'idle';
  soc: number | null;
  capacityAh: number | null;
  tempMin: number | null;
  tempMax: number | null;
  backupTimeH: number | null;
}

export const emptyValue = '—';

export const formatRelativeTime = (timestamp?: string | null) => {
  if (!timestamp) return 'No data';
  const diff = Math.max(0, (new Date().getTime() - new Date(timestamp).getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

export const phaseValues = (metric?: Pick<Metric, 'ac_v_l1' | 'ac_v_l2' | 'ac_v_l3'> | null) => [
  metric?.ac_v_l1 || 0,
  metric?.ac_v_l2 || 0,
  metric?.ac_v_l3 || 0,
];

export const hasAnyAcPhase = (metric?: Pick<Metric, 'ac_v_l1' | 'ac_v_l2' | 'ac_v_l3'> | null) =>
  phaseValues(metric).some(v => v > 0);

export const primaryAcVoltage = (metric?: Pick<Metric, 'ac_v_l1' | 'ac_v_l2' | 'ac_v_l3'> | null) =>
  phaseValues(metric).find(v => v > 0) || 0;

export const formatNumber = (value?: number | null, digits = 0) =>
  value == null || Number.isNaN(value) ? emptyValue : value.toFixed(digits);

export const formatPowerFactor = (pf?: number | null) =>
  pf && pf > 0 ? pf.toFixed(2) : emptyValue;

export const powerFactorLabel = (actual?: number | null, estimated?: number | null) =>
  actual && actual > 0 ? `AC PF ${formatPowerFactor(actual)}` : `EST PF ${formatPowerFactor(estimated)}`;

export const getMetricValue = (metric: Metric | undefined, key: keyof Metric) => {
  const value = metric?.[key];
  return typeof value === 'number' ? value : null;
};

export const buildSiteSnapshots = (sites: Site[], metrics: Metric[], devices: Device[]): SiteSnapshot[] =>
  sites.map(site => {
    const siteMetrics = metrics.filter(m => m.site_id === site.id);
    const ac = siteMetrics.find(m => m.device_type === 'ac_input');
    const batteries = siteMetrics.filter(m => m.device_type === 'battery');
    const rectifiers = siteMetrics.filter(m => m.device_type === 'rectifier');
    const device = devices.find(d => d.site_id === site.id);
    const systemVoltage = batteries.find(b => b.voltage && b.voltage > 0)?.voltage || 54;
    const totalBatteryCurrent = batteries.reduce((sum, b) => sum + (b.current || 0), 0);
    const totalBatteryPower = Math.round(systemVoltage * totalBatteryCurrent);
    const loadAmps = ac?.dc_power ?? null;
    const dcLoadWatts = loadAmps == null ? null : Math.round(systemVoltage * loadAmps);
    const estimatedPowerFactor = dcLoadWatts != null && (ac?.ac_power || 0) > 0
      ? Math.min(1, Math.max(0, dcLoadWatts / (ac!.ac_power || 1)))
      : null;
    const isAcFailure = !hasAnyAcPhase(ac);
    const isBatteryDischarging = totalBatteryCurrent < -0.1 || (isAcFailure && (dcLoadWatts || 0) > 0);
    const isBatteryCharging = totalBatteryCurrent > 0.1;
    const isGridSupplyingLoad = !isAcFailure && (dcLoadWatts || 0) > 0;
    const powerFlowState = isBatteryDischarging ? 'battery' : (isGridSupplyingLoad ? 'grid' : 'idle');
    const batteriesWithSoc = batteries.filter(b => b.soc != null);
    const capacityValues = batteries.map(b => b.capacity_ah).filter((v): v is number => v != null && v > 0);
    const weightedSocCapacity = batteriesWithSoc.reduce((sum, b) => sum + (b.capacity_ah && b.capacity_ah > 0 ? b.capacity_ah : 0), 0);
    const weightedSoc = weightedSocCapacity > 0
      ? batteriesWithSoc.reduce((sum, b) => sum + ((b.soc || 0) * (b.capacity_ah && b.capacity_ah > 0 ? b.capacity_ah : 0)), 0) / weightedSocCapacity
      : null;
    const averageSoc = batteriesWithSoc.length
      ? batteriesWithSoc.reduce((sum, b) => sum + (b.soc || 0), 0) / batteriesWithSoc.length
      : null;
    const allCellTemps = batteries.flatMap(b => b.cells_json?.cells.map(c => c.temp) || []);
    const aggregateTemps = allCellTemps.length
      ? allCellTemps
      : batteries.map(b => b.temp).filter((v): v is number => v != null);
    const backupValues = batteries
      .map(b => b.backup_time_h)
      .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
    const lastUpdated = ac?.timestamp || batteries[0]?.timestamp || null;

    return {
      site,
      device,
      ac,
      batteries,
      rectifiers,
      lastUpdated,
      isAcFailure,
      primaryAcVoltage: primaryAcVoltage(ac),
      acApparentPower: ac?.ac_power ?? null,
      acPowerFactor: ac?.ac_power_factor ?? null,
      estimatedPowerFactor,
      systemVoltage,
      totalBatteryCurrent,
      totalBatteryPower,
      totalDcLoadWatts: dcLoadWatts,
      totalDcLoadAmps: loadAmps,
      isGridSupplyingLoad,
      isBatteryDischarging,
      isBatteryCharging,
      powerFlowState,
      soc: weightedSoc != null ? Math.round(weightedSoc) : (averageSoc != null ? Math.round(averageSoc) : null),
      capacityAh: capacityValues.length ? capacityValues.reduce((a, b) => a + b, 0) : null,
      tempMin: aggregateTemps.length ? Math.min(...aggregateTemps) : null,
      tempMax: aggregateTemps.length ? Math.max(...aggregateTemps) : null,
      backupTimeH: backupValues.length ? backupValues[0] : null,
    };
  });
