import snmp from 'net-snmp';
import dotenv from 'dotenv';

dotenv.config();

export const OIDS = {
  system: {
    name: "1.3.6.1.4.1.2011.6.164.1.1.1.1.0",
  },
  ac_input: {
    v_l1: "1.3.6.1.4.1.2011.6.164.1.2.2.1.3.1",
    v_l2: "1.3.6.1.4.1.2011.6.164.1.2.2.1.3.2",
    v_l3: "1.3.6.1.4.1.2011.6.164.1.2.2.1.3.3",
    freq: "1.3.6.1.4.1.2011.6.164.1.2.1.2.0",
    power: "1.3.6.1.4.1.2011.6.164.1.2.1.3.0",
  },
  batteries: {
    voltage_base: "1.3.6.1.4.1.2011.6.164.1.18.2.1.1",
    current_base: "1.3.6.1.4.1.2011.6.164.1.18.2.1.2",
    soc_base: "1.3.6.1.4.1.2011.6.164.1.18.2.1.4",
    capacity_base: "1.3.6.1.4.1.2011.6.164.1.18.2.1.5",
  },
  rectifiers: {
    total_load: "1.3.6.1.4.1.2011.6.164.1.3.1.1.0",
    total_dc_power: "1.3.6.1.4.1.2011.6.164.1.3.1.2.0",
  }
};

// Polling with tolerance for missing OIDs (like L3)
export const pollRealData = async (ip: string, community: string) => {
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, community);
    const oidsList = [OIDS.ac_input.v_l1, OIDS.ac_input.v_l2, OIDS.ac_input.v_l3, OIDS.rectifiers.total_load];
    
    session.get(oidsList, (error: any, varbinds?: any[]) => {
      const results = oidsList.map((oid, index) => {
        const vb = varbinds ? varbinds[index] : null;
        return {
          oid,
          value: (vb && !snmp.isVarbindError(vb)) ? vb.value.toString() : "0"
        };
      });
      resolve(results);
      session.close();
    });
  });
};

export const walkBatteries = async (ip: string, community: string) => {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(ip, community);
    const results: any = {};

    session.walk(OIDS.batteries.voltage_base, 20, (varbinds: any[]) => {
      for (const vb of varbinds) {
        if (!snmp.isVarbindError(vb)) {
          const index = vb.oid.split('.').pop();
          if (index) {
            if (!results[index]) results[index] = { index };
            results[index].voltage = parseFloat(vb.value.toString()) / 10;
          }
        }
      }
    }, (error: any) => {
      if (error) reject(error);
      else resolve(Object.values(results));
      session.close();
    });
  });
};
