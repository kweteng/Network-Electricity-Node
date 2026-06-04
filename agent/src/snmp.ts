import snmp from 'net-snmp';
import dotenv from 'dotenv';

dotenv.config();

const SNMP_OPTIONS = { timeout: 5000, retries: 1 };
const debugSnmp = process.env.DEBUG_SNMP === 'true';

export const OIDS = {
  system: {
    name: "1.3.6.1.2.1.1.5.0",
  },
  // Huawei OIDs
  ac_input: {
    v_l1: "1.3.6.1.4.1.2011.6.164.1.5.2.1.1.4.1",
    v_l2: "1.3.6.1.4.1.2011.6.164.1.5.2.1.1.5.1",
    v_l3: "1.3.6.1.4.1.2011.6.164.1.5.2.1.1.6.1",
  },
  batteries: {
    voltage_base: "1.3.6.1.4.1.2011.6.164.1.18.2.1.1",
    total_current: "1.3.6.1.4.1.2011.6.164.1.4.2.1.0",
    pre_discharge_time: "1.3.6.1.4.1.2011.6.164.1.4.2.2.0",
    charge_status: "1.3.6.1.4.1.2011.6.164.1.4.2.3.0",
    rated_capacity: "1.3.6.1.4.1.2011.6.164.1.4.1.13.0",
    total_soc: "1.3.6.1.4.1.2011.6.164.1.4.2.10.0",
    total_remain_ah: "1.3.6.1.4.1.2011.6.164.1.4.2.9.0",
  },
  system_metrics: {
    busbar_volt: "1.3.6.1.4.1.2011.6.164.1.6.1.3.0",
    total_load_current: "1.3.6.1.4.1.2011.6.164.1.6.1.4.0",
    total_dc_power: "1.3.6.1.4.1.2011.6.164.1.6.1.5.0",
  },
  rectifiers: {
    total_current: "1.3.6.1.4.1.2011.6.164.1.3.1.3.0",
    total_quantity: "1.3.6.1.4.1.2011.6.164.1.3.1.4.0",
    total_dc_power: "1.3.6.1.4.1.2011.6.164.1.3.1.9.0",
    total_ac_input_power: "1.3.6.1.4.1.2011.6.164.1.3.1.11.0",
  },
  // ZTE OIDs (ZXDU68)
  zte: {
    busbar_volt: "1.3.6.1.4.1.3902.2800.1.2.3.1.6.0",
    smr_output_current: "1.3.6.1.4.1.3902.2800.1.2.3.1.3.0",
    battery_total_current: "1.3.6.1.4.1.3902.2800.1.2.3.1.4.0",
    total_load: "1.3.6.1.4.1.3902.2800.1.2.3.4.2.0",
    temp: "1.3.6.1.4.1.3902.2800.1.2.2.2.30.0",
    ac_freq: "1.3.6.1.4.1.3902.2800.1.2.3.2.9.0",
    ac_l1: "1.3.6.1.4.1.3902.2800.1.2.3.2.15.1.2.1.1",
    ac_l2: "1.3.6.1.4.1.3902.2800.1.2.3.2.15.1.2.1.2",
    ac_l3: "1.3.6.1.4.1.3902.2800.1.2.3.2.15.1.2.1.3",
    ac_i_l1: "1.3.6.1.4.1.3902.2800.1.2.3.2.16.1.2.1.1",
    ac_i_l2: "1.3.6.1.4.1.3902.2800.1.2.3.2.16.1.2.1.2",
    ac_i_l3: "1.3.6.1.4.1.3902.2800.1.2.3.2.16.1.2.1.3",
    batt_current: "1.3.6.1.4.1.3902.2800.1.2.3.1.4.0",
    soc: "1.3.6.1.4.1.3902.2800.1.2.2.1.22.0",
    load_current: "1.3.6.1.4.1.3902.2800.1.2.3.4.2.0",
    temperature: "1.3.6.1.4.1.3902.2800.1.2.2.2.30.0",
    battery_voltage_table: "1.3.6.1.4.1.3902.2800.1.2.3.4.4.1.2.1",
    battery_current_table: "1.3.6.1.4.1.3902.2800.1.2.3.4.5.1.2.1",
    battery_soc_table: "1.3.6.1.4.1.3902.2800.1.2.3.4.14.1.2.1"
  }
};

export const getSingleOid = async (session: any, oid: string): Promise<string> => {
  return new Promise((resolve) => {
    session.get([oid], (error: any, varbinds: any[]) => {
      if (error || !varbinds || snmp.isVarbindError(varbinds[0])) {
        resolve("0");
      } else {
        resolve(varbinds[0].value.toString());
      }
    });
  });
};

export const getHuaweiAcVoltage = async (session: any): Promise<{l1: string, l2: string, l3: string}> => {
  return new Promise((resolve) => {
    let valL1 = "0", valL2 = "0", valL3 = "0";
    session.subtree("1.3.6.1.4.1.2011.6.164.1.5.2.1.1", 20, (varbinds: any[]) => {
      for (const vb of varbinds) {
        if (!snmp.isVarbindError(vb)) {
          const oid = vb.oid.toString();
          const v = parseInt(vb.value.toString());
          if (oid.includes(".1.5.2.1.1.4.") && v > 0) valL1 = v.toString();
          if (oid.includes(".1.5.2.1.1.5.") && v > 0) valL2 = v.toString();
          if (oid.includes(".1.5.2.1.1.6.") && v > 0) valL3 = v.toString();
        }
      }
    }, (error: any) => {
      if (error) {
        console.error("Subtree error:", error);
      }
      resolve({ l1: valL1, l2: valL2, l3: valL3 });
    });
  });
};

interface HuaweiAcReading {
  l1V: number; l2V: number; l3V: number;
  l1I: number; l2I: number; l3I: number;
  freq: number;
  acPower: number;
  powerFactor: number;
}

interface HuaweiBatterySummary {
  voltage: number;
  current: number;
  soc: number;
  capacityAh: number;
  temp: number;
  backupTimeH: number;
  status: string;
}

interface HuaweiRectifierReading {
  index: number;
  voltage: number;
  current: number;
  dcPower: number;
  acVoltage: number;
  ratedEfficiency: number | null;
  temp: number | null;
  status: string;
}

const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
const isValidHuaweiValue = (v: number) => !isNaN(v) && v !== 0x7FFFFFFF && v !== -2147483648;
const normalizePercent = (raw: number) => raw > 100 ? raw / 10 : raw;
const parseValidNumber = (raw: string) => {
  const value = parseInt(raw);
  return isValidHuaweiValue(value) ? value : 0;
};
const normalizeBackupMinutes = (raw: string) => {
  const value = parseInt(raw);
  if (!isValidHuaweiValue(value) || value <= 0) return 0;
  return value / 60;
};
const parseZteNumber = (raw: string) => {
  const value = parseInt(raw);
  return isValidHuaweiValue(value) ? value : 0;
};

export const getHuaweiAcDistribution = async (session: any): Promise<HuaweiAcReading> => {
  return new Promise((resolve) => {
    const r: HuaweiAcReading = { l1V: 0, l2V: 0, l3V: 0, l1I: 0, l2I: 0, l3I: 0, freq: 0, acPower: 0, powerFactor: 0 };
    const root = "1.3.6.1.4.1.2011.6.164.1.5.2.1.1";
    const parseVarbind = (vb: any) => {
      if (snmp.isVarbindError(vb)) return;
      const parts = vb.oid.toString().split('.');
      const column = parseInt(parts[parts.length - 2]);
      const raw = parseInt(vb.value.toString());
      if (isNaN(raw) || raw === 0x7FFFFFFF) return;

      if (column === 4 || column === 5 || column === 6) {
        const v = inRange(raw, 1500, 3000) ? raw / 10 : (inRange(raw, 150, 300) ? raw : 0);
        if (column === 4) r.l1V = v;
        if (column === 5) r.l2V = v;
        if (column === 6) r.l3V = v;
      }
      if (column === 7 || column === 8 || column === 9) {
        const a = inRange(raw, 0, 1000) ? raw / 10 : (inRange(raw, 0, 100) ? raw : 0);
        if (column === 7) r.l1I = a;
        if (column === 8) r.l2I = a;
        if (column === 9) r.l3I = a;
      }
      if (column === 10 && inRange(raw, 450, 650)) r.freq = raw / 10;

      if ((column >= 7 && column <= 12) && raw !== 0) {
        if (debugSnmp) console.log(`[HW AC subtree] col=${column} raw=${raw} oid=${vb.oid}`);
      }
    };
    const finish = () => {
      const apparentPower = (r.l1V * r.l1I) + (r.l2V * r.l2I) + (r.l3V * r.l3I);
      r.acPower = apparentPower > 0 ? Math.round(apparentPower) : 0;
      r.powerFactor = 0;
      resolve(r);
    };
    const fallbackGetNext = (startOid = root, seen = 0) => {
      if (seen > 80) {
        finish();
        return;
      }
      session.getNext([startOid], (error: any, varbinds?: any[]) => {
        if (error || !varbinds?.length || snmp.isVarbindError(varbinds[0])) {
          finish();
          return;
        }
        const vb = varbinds[0];
        if (!vb.oid?.toString().startsWith(root)) {
          finish();
          return;
        }
        parseVarbind(vb);
        fallbackGetNext(vb.oid.toString(), seen + 1);
      });
    };

    session.subtree(root, 20, (varbinds: any[]) => {
      for (const vb of varbinds) {
        parseVarbind(vb);
      }
    }, (error: any) => {
      if (error && ![r.l1V, r.l2V, r.l3V].some(v => v > 0)) {
        fallbackGetNext();
        return;
      }
      if (error) console.error("AC subtree error:", error.message);
      finish();
    });
  });
};

export const getHuaweiBatterySummary = async (session: any): Promise<HuaweiBatterySummary> => {
  return new Promise((resolve) => {
    const rawByColumn = new Map<number, number>();

    session.subtree("1.3.6.1.4.1.2011.6.164.1.17.1.1", 20, (varbinds: any[]) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        const parts = vb.oid.toString().split('.');
        const column = parseInt(parts[parts.length - 2]);
        const raw = parseInt(vb.value.toString());
        if (!isValidHuaweiValue(raw)) continue;
        rawByColumn.set(column, raw);
      }
    }, (error: any) => {
      if (error) console.error("Battery summary subtree error:", error.message);

      const chargeStatus = rawByColumn.get(12) || 0;
      const statusByCode: Record<number, string> = {
        1: 'float',
        2: 'boost',
        3: 'discharge',
        4: 'hibernating',
        7: 'offline',
        255: 'unknown',
      };

      resolve({
        voltage: (rawByColumn.get(5) || 0) / 10,
        current: (rawByColumn.get(6) || 0) / 10,
        capacityAh: (rawByColumn.get(7) || 0) / 10,
        soc: normalizePercent(rawByColumn.get(8) || 0),
        temp: (rawByColumn.get(9) || 0) / 10,
        backupTimeH: (rawByColumn.get(11) || 0) / 10,
        status: statusByCode[chargeStatus] || '',
      });
    });
  });
};

export const pollZteData = async (ip: string, community: string, port = 161) => {
  const session = snmp.createSession(ip, community, { port, ...SNMP_OPTIONS });
  const batteryBanks = await walkZteBatteryBanks(session);
  const results = {
    l1: await getSingleOid(session, OIDS.zte.ac_l1),
    l2: await getSingleOid(session, OIDS.zte.ac_l2),
    l3: await getSingleOid(session, OIDS.zte.ac_l3),
    l1I: await getSingleOid(session, OIDS.zte.ac_i_l1),
    l2I: await getSingleOid(session, OIDS.zte.ac_i_l2),
    l3I: await getSingleOid(session, OIDS.zte.ac_i_l3),
    acFreq: await getSingleOid(session, OIDS.zte.ac_freq),
    busbar: await getSingleOid(session, OIDS.zte.busbar_volt),
    smrOutputCurrent: await getSingleOid(session, OIDS.zte.smr_output_current),
    battTotalCurrent: await getSingleOid(session, OIDS.zte.batt_current),
    battTotalSOC: batteryBanks.length
      ? String(Math.round(batteryBanks.reduce((sum, bank) => sum + bank.soc, 0) / batteryBanks.length))
      : await getSingleOid(session, OIDS.zte.soc),
    loadCurrent: await getSingleOid(session, OIDS.zte.load_current),
    temperature: await getSingleOid(session, OIDS.zte.temperature),
    batteryBanks,
  };
  session.close();
  return results;
};

const walkZteBatteryBanks = async (session: any): Promise<Array<{ index: number; voltage: number; current: number; soc: number }>> => {
  return new Promise((resolve) => {
    const banks = new Map<number, { index: number; voltage: number; current: number; soc: number }>();
    session.subtree("1.3.6.1.4.1.3902.2800.1.2.3.4", 20, (varbinds: any[]) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        const oid = vb.oid.toString();
        const raw = parseZteNumber(vb.value.toString());
        if (!raw) continue;
        const index = parseInt(oid.split('.').pop() || '0');
        if (!index || index > 8) continue;
        const bank = banks.get(index) || { index, voltage: 0, current: 0, soc: 0 };
        if (oid.startsWith(OIDS.zte.battery_voltage_table)) bank.voltage = raw / 100;
        if (oid.startsWith(OIDS.zte.battery_current_table)) bank.current = raw / 100;
        if (oid.startsWith(OIDS.zte.battery_soc_table)) bank.soc = raw;
        banks.set(index, bank);
      }
    }, (error: any) => {
      if (error) console.error("ZTE battery bank subtree error:", error.message);
      resolve([...banks.values()].filter((bank) => bank.voltage > 0 || bank.current > 0 || bank.soc > 0));
    });
  });
};

export const pollRealData = async (ip: string, community: string, port = 161) => {
  const session = snmp.createSession(ip, community, { port, ...SNMP_OPTIONS });

  const ac = await getHuaweiAcDistribution(session);
  const rectifierAcInputPower = parseValidNumber(await getSingleOid(session, OIDS.rectifiers.total_ac_input_power));
  const acPowerFactor = rectifierAcInputPower > 0 && ac.acPower > 0
    ? Math.min(1, Math.max(0, rectifierAcInputPower / ac.acPower))
    : 0;
  const batterySummary = await getHuaweiBatterySummary(session);
  const backupMinutesRaw = await getSingleOid(session, OIDS.batteries.pre_discharge_time);
  const backupTimeH = batterySummary.backupTimeH > 0
    ? batterySummary.backupTimeH
    : normalizeBackupMinutes(backupMinutesRaw);

  const results = {
    l1: ac.l1V.toString(),
    l2: ac.l2V.toString(),
    l3: ac.l3V.toString(),
    l1I: ac.l1I.toString(),
    l2I: ac.l2I.toString(),
    l3I: ac.l3I.toString(),
    acFreq: ac.freq.toString(),
    acPower: ac.acPower.toString(),
    acPowerFactor: acPowerFactor.toString(),
    busbar: await getSingleOid(session, OIDS.system_metrics.busbar_volt),
    battTotalCurrent: await getSingleOid(session, OIDS.batteries.total_current),
    battChargeStatus: await getSingleOid(session, OIDS.batteries.charge_status),
    battRatedCapacity: await getSingleOid(session, OIDS.batteries.rated_capacity),
    battTotalSOC: await getSingleOid(session, OIDS.batteries.total_soc),
    battRemainAh: await getSingleOid(session, OIDS.batteries.total_remain_ah),
    battBackupTimeH: backupTimeH.toString(),
    loadCurrent: await getSingleOid(session, OIDS.system_metrics.total_load_current),
    dcPower: await getSingleOid(session, OIDS.system_metrics.total_dc_power),
    battSummaryVoltage: batterySummary.voltage.toString(),
    battSummaryCurrent: batterySummary.current.toString(),
    battSummarySOC: batterySummary.soc.toString(),
    battSummaryCapacityAh: batterySummary.capacityAh.toString(),
    battSummaryTemp: batterySummary.temp.toString(),
    battSummaryStatus: batterySummary.status,
  };

  session.close();
  return results;
};

export const walkRectifiers = async (ip: string, community: string, port = 161): Promise<HuaweiRectifierReading[]> => {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(ip, community, { port, ...SNMP_OPTIONS });
    const rectifiers: Record<string, any> = {};

    const ensure = (index: string) => {
      if (!rectifiers[index]) rectifiers[index] = { snmpIndex: index };
      return rectifiers[index];
    };
    const statusByCode: Record<number, string> = {
      1: 'normal',
      2: 'fault',
      3: 'protect',
      4: 'commFail',
      5: 'switchOff',
      6: 'invalid',
      7: 'noConfig',
      8: 'acOff',
      9: 'rectLost',
      254: 'alarmResume',
      255: 'unknown',
    };

    session.subtree("1.3.6.1.4.1.2011.6.164.1.3.2", 20, (varbinds: any[]) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        const oid = vb.oid.toString();
        const parts = oid.split('.');
        const index = parts.pop();
        const column = Number(parts.pop());
        if (!index || !column) continue;

        const row = ensure(index);
        const rawString = vb.value.toString();
        const raw = parseInt(rawString);

        if (oid.includes(".1.3.2.1.1.")) {
          if (column === 2 && isValidHuaweiValue(raw)) row.equipId = raw;
          if (column === 3) row.name = rawString;
          if (column === 5) row.software = rawString;
          if (column === 8) row.serial = rawString;
          if (column === 10 && isValidHuaweiValue(raw)) row.configEfficiency = raw;
          continue;
        }

        if (!oid.includes(".1.3.2.2.1.") || !isValidHuaweiValue(raw)) continue;
        if (column === 2) row.current = raw / 10;
        if (column === 3) row.voltage = raw / 10;
        if (column === 5) row.dcPower = raw;
        if (column === 6) row.acVoltage = raw / 10;
        if (column === 7) row.ratedEfficiency = raw;
        if (column === 8) row.temp = raw / 10;
        if (column === 99) row.status = statusByCode[raw] || 'unknown';
      }
    }, (error: any) => {
      session.close();
      if (error) {
        reject(error);
        return;
      }

      const rows = Object.values(rectifiers)
        .filter((row: any) => row.voltage > 0 || row.current > 0 || row.dcPower > 0)
        .sort((a: any, b: any) => (a.equipId || Number(a.snmpIndex)) - (b.equipId || Number(b.snmpIndex)));

      resolve(rows.map((row: any, ordinal) => {
        const nameMatch = typeof row.name === 'string' ? row.name.match(/(\d+)$/) : null;
        const logicalIndex = nameMatch
          ? Number(nameMatch[1])
          : row.equipId
            ? row.equipId % 1000 || ordinal + 1
            : ordinal + 1;

        return {
          index: logicalIndex,
          voltage: row.voltage || 0,
          current: row.current || 0,
          dcPower: row.dcPower || 0,
          acVoltage: row.acVoltage || 0,
          ratedEfficiency: row.ratedEfficiency || row.configEfficiency || null,
          temp: row.temp ?? null,
          status: row.status || 'unknown',
        };
      }));
    });
  });
};

export const pollHuaweiBatterySummaryData = async (ip: string, community: string, port = 161) => {
  const session = snmp.createSession(ip, community, { port, ...SNMP_OPTIONS });
  const batterySummary = await getHuaweiBatterySummary(session);
  const backupMinutesRaw = await getSingleOid(session, OIDS.batteries.pre_discharge_time);
  const backupTimeH = batterySummary.backupTimeH > 0
    ? batterySummary.backupTimeH
    : normalizeBackupMinutes(backupMinutesRaw);

  const results = {
    battTotalCurrent: await getSingleOid(session, OIDS.batteries.total_current),
    battChargeStatus: await getSingleOid(session, OIDS.batteries.charge_status),
    battRatedCapacity: await getSingleOid(session, OIDS.batteries.rated_capacity),
    battTotalSOC: await getSingleOid(session, OIDS.batteries.total_soc),
    battRemainAh: await getSingleOid(session, OIDS.batteries.total_remain_ah),
    battBackupTimeH: backupTimeH.toString(),
    battSummaryVoltage: batterySummary.voltage.toString(),
    battSummaryCurrent: batterySummary.current.toString(),
    battSummarySOC: batterySummary.soc.toString(),
    battSummaryCapacityAh: batterySummary.capacityAh.toString(),
    battSummaryTemp: batterySummary.temp.toString(),
    battSummaryStatus: batterySummary.status,
  };

  session.close();
  return results;
};

export const walkBatteries = async (ip: string, community: string, port = 161) => {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(ip, community, { port, ...SNMP_OPTIONS });
    const results: any = {};
    const batteryTableOid = "1.3.6.1.4.1.2011.6.164.1.18.2.1"; // Lithium Battery Table

    const normalizeCellVoltage = (raw: number) => raw >= 300 ? raw / 100 : raw / 10;
    const normalizeCellTemp = (raw: number) => raw > 100 ? raw / 10 : raw;
    const normalizeCapacityAh = (raw: number) => raw >= 5000 ? raw / 100 : raw / 10;
    const upsertCell = (bank: any, idx: number) => {
      let cell = bank.cells.find((c: any) => c.idx === idx);
      if (!cell) {
        cell = { idx, v: 0, temp: 0 };
        bank.cells.push(cell);
      }
      return cell;
    };
    const parseBatteryVarbind = (vb: any) => {
      if (snmp.isVarbindError(vb)) return;
      const parts = vb.oid.split('.');
      const index = parts.pop();
      const column = parts.pop();
      if (!index || !column) return;
      if (!results[index]) {
        results[index] = { index, voltage: 0, current: 0, soh: null, capacityAh: 0, cells: [] };
      }
      const val = parseInt(vb.value.toString());
      if (isNaN(val) || val === 0x7FFFFFFF || val === -2147483648) return;
      const columnNum = parseInt(column);
      if (column === '1') { // Voltage (0.1V)
        results[index].voltage = val > 10000 ? 0 : val / 10;
      } else if (column === '2') { // Current (0.1A)
        let current = val;
        if (current > 2147483647) current = current - 4294967296;
        results[index].current = current / 10;
      } else if (column === '4') { // SOH (%), not SOC
        results[index].soh = val > 0 && val <= 100 ? val : null;
      } else if (column === '5') { // Capacity (Ah)
        results[index].capacityAh = normalizeCapacityAh(val);
      } else if (columnNum >= 6 && columnNum <= 20) {
        const cell = upsertCell(results[index], columnNum - 5);
        cell.v = normalizeCellVoltage(val);
      } else if (columnNum >= 22 && columnNum <= 36) {
        const cell = upsertCell(results[index], columnNum - 21);
        cell.temp = normalizeCellTemp(val);
      }
    };
    const finish = () => {
      for (const bank of Object.values(results) as any[]) {
        bank.cells = bank.cells
          .filter((c: any) => c.v > 0 || c.temp !== 0)
          .sort((a: any, b: any) => a.idx - b.idx);
      }
      session.close();
      resolve(Object.values(results));
    };
    const fallbackGetNext = (startOid = batteryTableOid, seen = 0) => {
      if (seen > 260) {
        finish();
        return;
      }
      session.getNext([startOid], (error: any, varbinds?: any[]) => {
        if (error || !varbinds?.length || snmp.isVarbindError(varbinds[0])) {
          finish();
          return;
        }
        const vb = varbinds[0];
        if (!vb.oid?.toString().startsWith(batteryTableOid)) {
          finish();
          return;
        }
        parseBatteryVarbind(vb);
        fallbackGetNext(vb.oid.toString(), seen + 1);
      });
    };

    session.subtree(batteryTableOid, 20, (varbinds: any[]) => {
      for (const vb of varbinds) {
        parseBatteryVarbind(vb);
      }
    }, (error: any) => {
      if (error && Object.keys(results).length === 0) {
        fallbackGetNext();
        return;
      }
      if (error) console.warn(`Battery subtree error for ${ip}; using partial battery rows: ${error.message}`);
      finish();
    });
  });
};
