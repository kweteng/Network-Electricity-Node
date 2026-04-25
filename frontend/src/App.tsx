import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { SchematicView } from './components/SchematicView';

interface Metric {
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
  ac_current: number | null;
  ac_freq: number | null;
  ac_power: number | null;
  ac_energy: number | null;
  dc_power: number | null;
  temp: number | null;
  capacity_ah: number | null;
  max_cell_v: number | null;
  min_cell_v: number | null;
  max_cell_temp: number | null;
  min_cell_temp: number | null;
  status: string;
}

interface Site {
  id: number;
  name: string;
  ip: string;
}

function App() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number>(1);

  useEffect(() => {
    const fetchSites = async () => {
      const res = await axios.get('http://localhost:3001/api/sites');
      setSites(res.data);
    };
    fetchSites();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get('http://localhost:3001/api/metrics/latest');
        setMetrics(res.data);
      } catch (e) {
        console.error('Failed to fetch metrics', e);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const currentMetrics = metrics.filter(m => m.site_id === selectedSiteId);
  const selectedSite = sites.find(s => s.id === selectedSiteId);

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', backgroundColor: '#121212', color: 'white', minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
        <div>
          <h1 style={{ margin: 0 }}>NGalarm Dashboard</h1>
          <p style={{ color: '#888' }}>Huawei Site Monitoring - Multi Site Support</p>
        </div>
        
        {/* Site Selector */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {sites.map(site => (
            <button 
              key={site.id}
              onClick={() => setSelectedSiteId(site.id)}
              style={{
                padding: '10px 20px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: selectedSiteId === site.id ? '#3b82f6' : '#333',
                color: 'white',
                fontWeight: 'bold',
                transition: '0.2s'
              }}
            >
              {site.name} ({site.ip})
            </button>
          ))}
        </div>
      </header>
      
      <main>
        <div style={{ background: '#222', padding: '20px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <h2 style={{ marginTop: 0 }}>{selectedSite?.name} <span style={{ fontSize: '14px', color: '#888' }}>- {selectedSite?.ip}</span></h2>
             <span style={{ fontSize: '12px', color: '#4ade80' }}>● System Online</span>
          </div>
          <SchematicView metrics={currentMetrics} />
        </div>
      </main>
    </div>
  );
}

export default App;
