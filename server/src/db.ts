import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const initDb = async () => {
  if (process.env.INIT_DB_RESET === 'true') {
    await pool.query('DROP TABLE IF EXISTS metrics CASCADE');
    await pool.query('DROP TABLE IF EXISTS devices CASCADE');
    await pool.query('DROP TABLE IF EXISTS sites CASCADE');
  }
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      site_type TEXT NOT NULL DEFAULT 'lithium'
    );

    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 161,
      community TEXT NOT NULL DEFAULT 'public',
      type TEXT NOT NULL DEFAULT 'huawei_enspire',
      is_mock BOOLEAN DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
      device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      device_type TEXT,
      index INTEGER,
      voltage FLOAT,
      current FLOAT,
      soc FLOAT,
      soh FLOAT,
      ac_voltage FLOAT,
      ac_v_l1 FLOAT,
      ac_v_l2 FLOAT,
      ac_v_l3 FLOAT,
      ac_i_l1 FLOAT,
      ac_i_l2 FLOAT,
      ac_i_l3 FLOAT,
      ac_current FLOAT,
      ac_freq FLOAT,
      ac_power FLOAT,
      ac_power_factor FLOAT,
      ac_energy FLOAT,
      dc_power FLOAT,
      temp FLOAT,
      backup_time_h FLOAT,
      capacity_ah FLOAT,
      max_cell_v FLOAT,
      min_cell_v FLOAT,
      max_cell_temp FLOAT,
      min_cell_temp FLOAT,
      cells_json JSONB,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS latest_metrics (
      site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
      device_type TEXT NOT NULL,
      index INTEGER NOT NULL,
      device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      voltage FLOAT,
      current FLOAT,
      soc FLOAT,
      soh FLOAT,
      ac_voltage FLOAT,
      ac_v_l1 FLOAT,
      ac_v_l2 FLOAT,
      ac_v_l3 FLOAT,
      ac_i_l1 FLOAT,
      ac_i_l2 FLOAT,
      ac_i_l3 FLOAT,
      ac_current FLOAT,
      ac_freq FLOAT,
      ac_power FLOAT,
      ac_power_factor FLOAT,
      ac_energy FLOAT,
      dc_power FLOAT,
      temp FLOAT,
      backup_time_h FLOAT,
      capacity_ah FLOAT,
      max_cell_v FLOAT,
      min_cell_v FLOAT,
      max_cell_temp FLOAT,
      min_cell_temp FLOAT,
      cells_json JSONB,
      status TEXT,
      PRIMARY KEY (site_id, device_type, index)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_metrics_latest
    ON metrics (site_id, device_type, index, timestamp DESC);
  `);

  await pool.query(`
    ALTER TABLE metrics
      ADD COLUMN IF NOT EXISTS backup_time_h FLOAT;
  `);

  await pool.query(`
    ALTER TABLE latest_metrics
      ADD COLUMN IF NOT EXISTS backup_time_h FLOAT;
  `);

  await pool.query(`
    INSERT INTO latest_metrics (
      site_id, device_type, index, device_id, timestamp,
      voltage, current, soc, soh,
      ac_voltage, ac_v_l1, ac_v_l2, ac_v_l3, ac_i_l1, ac_i_l2, ac_i_l3,
      ac_current, ac_freq, ac_power, ac_power_factor, ac_energy,
      dc_power, temp, backup_time_h, capacity_ah,
      max_cell_v, min_cell_v, max_cell_temp, min_cell_temp, cells_json, status
    )
    SELECT DISTINCT ON (site_id, device_type, index)
      site_id, device_type, index, device_id, timestamp,
      voltage, current, soc, soh,
      ac_voltage, ac_v_l1, ac_v_l2, ac_v_l3, ac_i_l1, ac_i_l2, ac_i_l3,
      ac_current, ac_freq, ac_power, ac_power_factor, ac_energy,
      dc_power, temp, backup_time_h, capacity_ah,
      max_cell_v, min_cell_v, max_cell_temp, min_cell_temp, cells_json, status
    FROM metrics
    WHERE site_id IS NOT NULL AND device_type IS NOT NULL AND index IS NOT NULL
    ORDER BY site_id, device_type, index, timestamp DESC
    ON CONFLICT (site_id, device_type, index) DO UPDATE SET
      device_id = EXCLUDED.device_id,
      timestamp = EXCLUDED.timestamp,
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
    WHERE latest_metrics.timestamp IS NULL OR EXCLUDED.timestamp >= latest_metrics.timestamp;
  `);

  await pool.query(
    "UPDATE sites SET name = 'KANTOR TEBING TINGGI' WHERE name = 'POP Tebing Tinggi'"
  );

  await pool.query(`
    UPDATE sites
    SET location = CASE name
      WHEN 'KANTOR TEBING TINGGI' THEN 'Tebing Tinggi'
      WHEN 'POP TUNGKAL' THEN 'Kuala Tungkal'
      WHEN 'POP Pematang LUMUT' THEN 'Pematang Lumut'
      WHEN 'POP KOMINFO Merangin' THEN 'Bangko'
      WHEN 'POP Kerinci' THEN 'Sungai Penuh'
      WHEN 'POP Server Tebing Tinggi' THEN 'Tebing Tinggi'
      WHEN 'POP TELNI' THEN 'Teluk Nilau'
      WHEN 'POP PURWODADI' THEN 'Purwodadi'
      WHEN 'POP TELUK NILAU' THEN 'Teluk Nilau'
      ELSE location
    END
  `);

  await pool.query(`
    UPDATE sites
    SET name = 'POP TELNI', location = 'Teluk Nilau', site_type = 'zte'
    WHERE name IN ('POP TELNI', 'POP TELUK NILAU')
  `);

  await pool.query(`
    UPDATE devices
    SET name = 'ZTE ZXDU68',
        ip = '192.168.101.5',
        port = 161,
        community = 'public',
        type = 'zte_power',
        is_mock = false
    WHERE site_id IN (SELECT id FROM sites WHERE name = 'POP TELNI')
  `);

  await pool.query(`
    DELETE FROM sites
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM sites
      GROUP BY name
    )
      AND name = 'POP TELNI'
  `);

  await pool.query(`
    UPDATE sites
    SET site_type = 'lithium'
    WHERE name IN ('POP Kerinci', 'POP Pematang LUMUT', 'POP KOMINFO Merangin')
  `);

  await pool.query(`
    UPDATE devices
    SET name = 'Lithium SMU'
    WHERE site_id IN (SELECT id FROM sites WHERE name IN ('POP Kerinci', 'POP Pematang LUMUT', 'POP KOMINFO Merangin'))
      AND name = 'Standard SMU'
  `);

  await pool.query(`
    DELETE FROM metrics
    WHERE site_id IN (SELECT id FROM sites WHERE name IN ('POP Kerinci', 'POP Pematang LUMUT', 'POP KOMINFO Merangin'))
      AND device_type = 'battery'
      AND index = 1
      AND cells_json IS NULL
  `);

  await pool.query(`
    DELETE FROM latest_metrics
    WHERE site_id IN (SELECT id FROM sites WHERE name IN ('POP Kerinci', 'POP Pematang LUMUT', 'POP KOMINFO Merangin'))
      AND device_type = 'battery'
      AND index = 1
      AND cells_json IS NULL
  `);
  
  const existingSites = await pool.query('SELECT COUNT(*)::int AS count FROM sites');
  if (existingSites.rows[0].count > 0) {
    return;
  }

  // Insert initial sites
  const sites = [
    { name: 'KANTOR TEBING TINGGI', location: 'Tebing Tinggi', site_type: 'lithium' },
    { name: 'POP TUNGKAL', location: 'Kuala Tungkal', site_type: 'lithium' },
    { name: 'POP Pematang LUMUT', location: 'Pematang Lumut', site_type: 'lithium' },
    { name: 'POP KOMINFO Merangin', location: 'Bangko', site_type: 'lithium' },
    { name: 'POP Kerinci', location: 'Sungai Penuh', site_type: 'lithium' },
    { name: 'POP Server Tebing Tinggi', location: 'Tebing Tinggi', site_type: 'zte' },
    { name: 'POP TELNI', location: 'Teluk Nilau', site_type: 'zte' },
    { name: 'POP PURWODADI', location: 'Purwodadi', site_type: 'lithium' }
  ];

  for (const site of sites) {
    const res = await pool.query('INSERT INTO sites (name, location, site_type) VALUES ($1, $2, $3) RETURNING id', [site.name, site.location, site.site_type]);
    const siteId = res.rows[0].id;

    // Insert a device for each site
    if (site.name === 'KANTOR TEBING TINGGI') {
      await pool.query(
        'INSERT INTO devices (site_id, name, ip, port, community, type, is_mock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [siteId, 'Enspire Controller', '10.111.11.20', 161, 'Anekanet', 'huawei_enspire', false]
      );
    } else if (site.name === 'POP TUNGKAL') {
      await pool.query(
        'INSERT INTO devices (site_id, name, ip, port, community, type, is_mock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [siteId, 'Mock Controller', '10.113.13.52', 161, 'Anekanet', 'huawei_enspire', false]
      );
    } else if (site.name === 'POP Pematang LUMUT') {
      await pool.query(
        'INSERT INTO devices (site_id, name, ip, port, community, type, is_mock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [siteId, 'Lithium SMU', '10.111.11.52', 161, 'Anekanet', 'huawei_enspire', false]
      );
    } else if (site.name === 'POP KOMINFO Merangin') {
      await pool.query(
        'INSERT INTO devices (site_id, name, ip, port, community, type, is_mock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [siteId, 'Lithium SMU', '103.154.178.110', 8091, 'Anekanet', 'huawei_enspire', false]
      );
    } else if (site.name === 'POP Kerinci') {
      await pool.query(
        'INSERT INTO devices (site_id, name, ip, port, community, type, is_mock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [siteId, 'Lithium SMU', '103.23.196.22', 985, 'Anekanet', 'huawei_enspire', false]
      );
    } else if (site.name === 'POP Server Tebing Tinggi') {
      await pool.query(
        'INSERT INTO devices (site_id, name, ip, port, community, type, is_mock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [siteId, 'ZTE ZXDU68', '10.111.11.17', 161, 'public', 'zte_power', false]
      );
    } else if (site.name === 'POP TELNI') {
      await pool.query(
        'INSERT INTO devices (site_id, name, ip, port, community, type, is_mock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [siteId, 'ZTE ZXDU68', '192.168.101.5', 161, 'public', 'zte_power', false]
      );
    } else if (site.name === 'POP PURWODADI') {
      await pool.query(
        'INSERT INTO devices (site_id, name, ip, port, community, type, is_mock) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [siteId, 'Lithium SMU', '10.111.11.123', 161, 'Anekanet', 'huawei_enspire', false]
      );
    }
  }
};

export default pool;
