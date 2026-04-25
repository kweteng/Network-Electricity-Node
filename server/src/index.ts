import express from 'express';
import cors from 'cors';
import { initDb } from './db';
import pool from './db';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Ingest metrics from agents
app.post('/api/metrics/ingest', async (req, res) => {
  const { siteId, metrics } = req.body;
  console.log(`Received ${metrics.length} metrics from site ${siteId}. Types: ${metrics.map((m:any) => m.deviceType).join(', ')}`);
  try {
    for (const m of metrics) {
      await pool.query(
        'INSERT INTO metrics (site_id, device_type, index, voltage, current, soc, soh, ac_voltage, ac_v_l1, ac_v_l2, ac_v_l3, ac_current, ac_freq, ac_power, ac_energy, dc_power, temp, capacity_ah, max_cell_v, min_cell_v, max_cell_temp, min_cell_temp, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)',
        [
          siteId, m.deviceType, m.index, m.voltage, m.current, m.soc, m.soh, 
          m.acVoltage, m.acVL1, m.acVL2, m.acVL3, m.acCurrent, m.acFreq, m.acPower, m.acEnergy,
          m.dcPower, m.temp, m.capacityAh, m.maxCellV, m.minCellV, m.maxCellTemp, m.minCellTemp, m.status
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
    const result = await pool.query(`
      SELECT DISTINCT ON (site_id, device_type, index) *
      FROM metrics
      ORDER BY site_id, device_type, index, timestamp DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Latest metrics error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/sites', async (req, res) => {
  const result = await pool.query('SELECT * FROM sites');
  res.json(result.rows);
});

initDb().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});
