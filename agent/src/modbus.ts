import net from 'net';

const timeoutMs = Number(process.env.MODBUS_TIMEOUT_MS || 3000);

type RegisterRead = {
  address: number;
  value: number;
  signed: number;
};

export type HuaweiModbusData = {
  l1: string;
  l2: string;
  l3: string;
  l1I: string;
  l2I: string;
  l3I: string;
  acFreq: string;
  acPower: string;
  acPowerFactor: string;
  busbar: string;
  loadCurrent: string;
  dcPower: string;
};

const toSigned16 = (value: number) => (value & 0x8000 ? value - 0x10000 : value);
const validPositive = (value?: number) => value != null && value > 0 && value !== 0x7fff && value !== 0xffff;

const readHoldingRegisters = (
  host: string,
  port: number,
  unitId: number,
  start: number,
  count: number,
): Promise<RegisterRead[]> => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const transactionId = Math.floor(Math.random() * 0xffff);
    const request = Buffer.alloc(12);

    request.writeUInt16BE(transactionId, 0);
    request.writeUInt16BE(0, 2);
    request.writeUInt16BE(6, 4);
    request.writeUInt8(unitId, 6);
    request.writeUInt8(3, 7);
    request.writeUInt16BE(start, 8);
    request.writeUInt16BE(count, 10);

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Modbus timeout reading ${start}+${count}`));
    }, timeoutMs);

    socket.on('connect', () => socket.write(request));
    socket.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('data', (chunk: Buffer) => {
      clearTimeout(timer);
      socket.end();

      if (chunk.length < 9) {
        reject(new Error(`Short Modbus response (${chunk.length} bytes)`));
        return;
      }

      const responseTransactionId = chunk.readUInt16BE(0);
      const functionCode = chunk.readUInt8(7);
      if (responseTransactionId !== transactionId) {
        reject(new Error(`Modbus transaction mismatch: ${responseTransactionId} != ${transactionId}`));
        return;
      }
      if (functionCode & 0x80) {
        reject(new Error(`Modbus exception ${chunk.readUInt8(8)} for ${start}+${count}`));
        return;
      }

      const byteCount = chunk.readUInt8(8);
      const registers: RegisterRead[] = [];
      for (let i = 0; i < byteCount / 2; i++) {
        const value = chunk.readUInt16BE(9 + i * 2);
        registers.push({ address: start + i, value, signed: toSigned16(value) });
      }
      resolve(registers);
    });
  });
};

const toMap = (registers: RegisterRead[]) => {
  const map = new Map<number, number>();
  for (const register of registers) {
    map.set(register.address, register.signed);
  }
  return map;
};

export const pollHuaweiModbusData = async (host: string, port = 502, unitId = 1): Promise<HuaweiModbusData> => {
  const realtime = toMap(await readHoldingRegisters(host, port, unitId, 4096, 16));
  const power = toMap(await readHoldingRegisters(host, port, unitId, 4352, 8));

  const busbar = realtime.get(4096) || 0;
  const loadCurrent = realtime.get(4097) || 0;
  const l1 = realtime.get(4102) || 0;
  const l2 = realtime.get(4103) || 0;
  const l3 = realtime.get(4104) || 0;
  const l1I = realtime.get(4105) || 0;
  const l2I = realtime.get(4106) || 0;
  const l3I = realtime.get(4107) || 0;
  const freq = realtime.get(4108) || 0;
  const dcPower = power.get(4355) || 0;
  const apparentPower =
    (validPositive(l1) && validPositive(l1I) ? (l1 / 10) * (l1I / 10) : 0) +
    (validPositive(l2) && validPositive(l2I) ? (l2 / 10) * (l2I / 10) : 0) +
    (validPositive(l3) && validPositive(l3I) ? (l3 / 10) * (l3I / 10) : 0);

  return {
    l1: validPositive(l1) ? String(l1 / 10) : '0',
    l2: validPositive(l2) ? String(l2 / 10) : '0',
    l3: validPositive(l3) ? String(l3 / 10) : '0',
    l1I: validPositive(l1I) ? String(l1I / 10) : '0',
    l2I: validPositive(l2I) ? String(l2I / 10) : '0',
    l3I: validPositive(l3I) ? String(l3I / 10) : '0',
    acFreq: validPositive(freq) ? String(freq) : '0',
    acPower: String(Math.round(apparentPower)),
    acPowerFactor: '0',
    busbar: validPositive(busbar) ? String(busbar) : '0',
    loadCurrent: validPositive(loadCurrent) ? String(loadCurrent) : '0',
    dcPower: validPositive(dcPower) ? String(dcPower) : '0',
  };
};
