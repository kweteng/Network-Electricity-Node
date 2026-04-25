import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const initDb = async () => {
  // For prototype schema update
  await pool.query('DROP TABLE IF EXISTS metrics CASCADE');
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sites (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      ip TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
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
      ac_current FLOAT,
      ac_freq FLOAT,
      ac_power FLOAT,
      ac_energy FLOAT,
      dc_power FLOAT,
      temp FLOAT,
      capacity_ah FLOAT,
      max_cell_v FLOAT,
      min_cell_v FLOAT,
      max_cell_temp FLOAT,
      min_cell_temp FLOAT,
      status TEXT
    );
  `);
  
  // Insert initial sites if not exist
  const sites = [
    { name: 'RECTI_TBG_OFFICE', ip: '10.111.11.20' },
    { name: 'Site-2', ip: '10.113.13.52' },
    { name: 'Site-3', ip: '10.111.11.52' },
    { name: 'Site-4', ip: '10.111.11.62' }
  ];

  for (const site of sites) {
    const res = await pool.query('SELECT * FROM sites WHERE ip = $1', [site.ip]);
    if (res.rowCount === 0) {
      await pool.query('INSERT INTO sites (name, ip) VALUES ($1, $2)', [site.name, site.ip]);
    }
  }
};

export default pool;
