import snmp from 'net-snmp';
import dotenv from 'dotenv';

dotenv.config();

const target = '10.111.11.20';
const community = 'Anekanet';

// OIDs to test based on MIB analysis
const testOids = [
  "1.3.6.1.4.1.2011.6.164.1.4.2.1.0", // batteryGroupStatus (example)
  "1.3.6.1.4.1.2011.6.164.1.2.1.1.0", // L1 Voltage (example)
  "1.3.6.1.4.1.2011.6.164.1.4.2.2.0"  // Total Voltage
];

console.log(`Starting SNMP Diagnostic for ${target}...`);

const session = snmp.createSession(target, community);

session.get(testOids, (error: any, varbinds: any) => {
    if (error) {
        console.error("SNMP GET Error:", error.toString());
        if (error.toString().includes("RequestTimedOut")) {
            console.error("DEBUG: Request timed out. Check IP connectivity and SNMP port 161.");
        }
    } else {
        for (let i = 0; i < varbinds.length; i++) {
            if (snmp.isVarbindError(varbinds[i])) {
                console.error(`OID ${testOids[i]} Error: ` + snmp.varbindError(varbinds[i]));
            } else {
                console.log(`OID ${varbinds[i].oid}: ${varbinds[i].value}`);
            }
        }
    }
    session.close();
});

// Also try a walk to see what's available under the Huawei root
console.log("Attempting SNMP Walk on Huawei Root (1.3.6.1.4.1.2011.6.164.1)...");
const walkSession = snmp.createSession(target, community);
walkSession.walk("1.3.6.1.4.1.2011.6.164.1", 10, (varbinds: any) => {
    for (let i = 0; i < varbinds.length; i++) {
        console.log(`WALK: ${varbinds[i].oid} = ${varbinds[i].value}`);
    }
}, (error: any) => {
    if (error) console.error("SNMP WALK Error:", error.toString());
    walkSession.close();
});
