import React from 'react';

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

interface Props {
  metrics: Metric[];
}

export const SchematicView: React.FC<Props> = ({ metrics }) => {
  const batteries = metrics
    .filter(m => m.device_type === 'battery')
    .filter(m => {
      // If Site 1 (RECTI_TBG_OFFICE), show only indices 3669-3675
      if (m.site_id === 1) {
        const idx = m.index;
        return idx >= 3669 && idx <= 3675;
      }
      return true; // For other sites, show all
    })
    .sort((a,b) => a.index - b.index);
  const rectifiers = metrics.filter(m => m.device_type === 'rectifier').sort((a,b) => a.index - b.index);
  const acInput = metrics.find(m => m.device_type === 'ac_input');

  return (
    <div style={{ background: '#1a1a1a', padding: '20px', borderRadius: '8px', marginTop: '20px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>System Schematic (Live Data)</h3>
        <div style={{ fontSize: '12px', color: '#888' }}>
          Last Update: {metrics[0] ? new Date(metrics[0].timestamp).toLocaleTimeString() : 'N/A'}
        </div>
      </header>
      
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '10px' }}>
        
        {/* AC Input (3-Phase) */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: '#888' }}>MAINS (AC)</div>
          <div style={{ 
            marginTop: '10px',
            padding: '12px',
            background: '#1e293b',
            borderRadius: '4px',
            border: '2px solid #3b82f6',
            minWidth: '140px'
          }}>
            <div style={{ textAlign: 'left', fontSize: '13px' }}>
              <div>L1: <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{acInput?.ac_v_l1?.toFixed(1) || '0'}V</span></div>
              <div>L2: <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{acInput?.ac_v_l2?.toFixed(1) || '0'}V</span></div>
              <div>L3: <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{acInput?.ac_v_l3?.toFixed(1) || '0'}V</span></div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: '24px', alignSelf: 'center' }}>➔</div>

        {/* Rectifiers */}
        <div>
          <div style={{ fontSize: '10px', color: '#888' }}>RECTIFIERS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 60px)', gap: '8px', marginTop: '10px' }}>
            {rectifiers.length > 0 ? rectifiers.map(r => (
              <div key={r.index} style={{ 
                height: '70px', 
                background: r.status === 'normal' ? '#065f46' : '#991b1b', 
                borderRadius: '4px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                border: '1px solid #059669'
              }}>
                <div style={{ fontWeight: 'bold' }}>R{r.index}</div>
                <div>{(r.current || 0).toFixed(1)}A</div>
              </div>
            )) : <div style={{ color: '#666', fontSize: '10px' }}>No Data</div>}
          </div>
        </div>

        <div style={{ fontSize: '24px', alignSelf: 'center' }}>➔</div>

        {/* Busbar */}
        <div style={{ alignSelf: 'center', background: '#333', padding: '20px', borderRadius: '4px', borderLeft: '5px solid #eab308', textAlign: 'center' }}>
          <div style={{ fontSize: '10px', color: '#888' }}>DC BUS</div>
          <div style={{ fontSize: '24px', color: '#facc15', fontWeight: 'bold' }}>
            {(rectifiers[0]?.voltage || batteries[0]?.voltage || 0).toFixed(1)} VDC
          </div>
        </div>

        <div style={{ fontSize: '24px', alignSelf: 'center' }}>➔</div>

        {/* Battery Banks (Lithium) */}
        <div>
          <div style={{ fontSize: '10px', color: '#888' }}>LITHIUM BANKS ({batteries.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', maxHeight: '400px', overflowY: 'auto' }}>
            {batteries.map((b, i) => (
              <div key={b.index} style={{ 
                background: '#1e3a8a', 
                padding: '10px 15px', 
                borderRadius: '4px',
                fontSize: '11px',
                minWidth: '240px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                border: '1px solid #3b82f6'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1d4ed8', paddingBottom: '4px' }}>
                  <strong>Bank {i + 1} <span style={{ fontSize: '9px', opacity: 0.6 }}>ID:{b.index}</span></strong>
                  <span style={{ color: '#4ade80', fontWeight: 'bold' }}>{b.soc?.toFixed(0)}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{b.voltage?.toFixed(1)}V / {b.current?.toFixed(1)}A</span>
                  <span style={{ color: b.capacity_ah === 150 ? '#facc15' : '#fff' }}>{b.capacity_ah || 100}Ah</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};
