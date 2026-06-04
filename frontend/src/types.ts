export interface Metric {
  id: number;
  site_id: number;
  timestamp: string;
  device_type: string;
  index: number;
  voltage: number | null;
  current: number | null;
  soc: number | null;
  soh: number | null;
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
  cells_json: { cells: { idx: number; v: number; temp: number }[] } | null;
  status: string;
}

export interface Site {
  id: number;
  name: string;
  location: string;
  site_type: string;
}

export interface Device {
  id: number;
  site_id: number;
  name: string;
  ip: string;
  port: number;
  community: string;
}

export type DiagnosticType = 'overview' | 'grid' | 'dc' | 'battery';
