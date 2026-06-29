import pool from './db';

export const runCleanup = async () => {
  try {
    const result = await pool.query(`DELETE FROM metrics WHERE timestamp < NOW() - INTERVAL '30 days'`);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} old metrics.`);
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  }
};
