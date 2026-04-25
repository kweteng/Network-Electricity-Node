import axios from 'axios';
import dotenv from 'dotenv';
import { pollRealData, walkBatteries } from './snmp';

dotenv.config();

const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';

const generateMockMetrics = (siteId: number) => {
  const metrics: any[] = [];
  // AC Input (3-Phase + Detail)
  metrics.push({
    deviceType: 'ac_input',
    index: 1,
    acVL1: 220 + Math.random() * 5,
    acVL2: 218 + Math.random() * 5,
    acVL3: 221 + Math.random() * 5,
    acCurrent: 15 + Math.random(),
    acFreq: 50 + Math.random() * 0.5,
    acPower: 2.8 + Math.random() * 0.5,
    acEnergy: 50475 + Math.random() * 10,
    status: 'normal',
  });
  // Simulate 6 battery banks
  for (let i = 1; i <= 6; i++) {
    metrics.push({
      deviceType: 'battery',
      index: i,
      voltage: 53.9,
      current: Math.random() * 2,
      soc: 90 + Math.random() * 10,
      soh: 98,
      capacityAh: i === 3 ? 150 : 100, // Matching your info
      maxCellV: 3.41,
      minCellV: 3.39,
      maxCellTemp: 23,
      minCellTemp: 22,
      status: 'float',
    });
  }
  // Simulate 4 rectifiers
  for (let i = 1; i <= 4; i++) {
    metrics.push({
      deviceType: 'rectifier',
      index: i,
      voltage: 54.0,
      current: 20 + Math.random() * 10,
      dcPower: 1.2 + Math.random() * 0.5,
      temp: 26 + Math.random() * 5,
      status: 'normal',
    });
  }
  return metrics;
};

const run = async () => {
  console.log('Agent starting (Hybrid Mode: Real + Mock)...');
  
  let currentSiteIdx = 0;
  const sites = [
    { id: 1, ip: '10.111.11.20', mock: false },
    { id: 2, ip: '10.113.13.52', mock: true },
    { id: 3, ip: '10.111.11.52', mock: true },
    { id: 4, ip: '10.111.11.62', mock: true },
  ];

  setInterval(async () => {
    let metrics: any[] = [];
    const site = sites[currentSiteIdx];
    
    if (site.mock) {
       metrics = generateMockMetrics(site.id);
    } else {
      console.log(`Polling REAL data for Site: ${site.ip}`);
      try {
        const batteries: any = await walkBatteries(site.ip, 'Anekanet');
        for (const b of batteries) {
          metrics.push({
            deviceType: 'battery',
            index: parseInt(b.index),
            voltage: b.voltage,
            current: 0, 
            soc: 98, // Mock for now until we add walk for soc
            soh: 100,
            capacityAh: b.index === '3672' ? 150 : 100, // Adjust based on index from walk
            status: 'online'
          });
        }
        // Fetch AC
        const ac: any = await pollRealData(site.ip, 'Anekanet');
        metrics.push({
          deviceType: 'ac_input',
          index: 1,
          acVL1: parseFloat(ac[0].value) / 10,
          acVL2: parseFloat(ac[1].value) / 10,
          acVL3: parseFloat(ac[2].value) / 10,
          acCurrent: 0,
          acFreq: 50,
          acPower: 2.8,
          status: 'normal'
        });
      } catch (e: any) {
        console.error(`Real Polling failed for ${site.ip}:`, e.message);
        metrics = generateMockMetrics(site.id);
      }
    }

    if (metrics.length > 0) {
      try {
        await axios.post(`${serverUrl}/api/metrics/ingest`, {
          siteId: site.id,
          metrics,
        });
        console.log(`Pushed ${metrics.length} metrics for Site ${site.id} to server`);
      } catch (error: any) {
        console.error('Failed to push to server:', error.message);
      }
    }

    currentSiteIdx = (currentSiteIdx + 1) % sites.length;
  }, 5000); 
};

run();
