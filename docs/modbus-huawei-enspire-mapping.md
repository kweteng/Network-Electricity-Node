# Huawei Enspire TCP Modbus Mapping

Working notes for local-only TCP Modbus development. Current verified target:

- Site: KANTOR TEBING TINGGI
- IP: `10.111.11.20`
- TCP port: `502`
- Unit ID: `1`
- Function: `03` Holding Registers
- Mode tested: plain TCP Modbus, SSL disabled on the Huawei controller

Do not deploy Modbus polling to the remote production host until explicitly instructed.

## UI Overhaul Todo

- [ ] Keep Modbus telemetry visually marked as local/experimental until mappings are verified across KANTOR TEBING TINGGI and POP TUNGKAL.
- [ ] In the redesigned UI, separate source reliability from metric value so SNMP fallback and Modbus readings are understandable.
- [ ] Graph Modbus-derived values under the same AC, DC/load, battery, and alarm groups as SNMP values once verified.
- [ ] Do not enable production Modbus polling from UI work unless the user explicitly commands it in the current turn.

## Site Reachability

| Site | IP | TCP 502 | Modbus Result | Notes |
| --- | --- | --- | --- | --- |
| KANTOR TEBING TINGGI | `10.111.11.20` | Open | Working | Plain TCP Modbus responds. |
| POP TUNGKAL | `10.113.13.52` | Timeout | Not accessible yet | Web UI HTTPS on `443` responds, but plain TCP Modbus `502` still times out from the local dev machine after SSL was disabled. |
| POP Pematang LUMUT | `10.111.11.52` | Refused/closed | Not available | Likely SMU02B/no TCP Modbus. |

## Probe Command

```bash
cd agent
npx ts-node src/modbus_probe.ts 10.111.11.20 502 1
```

For careful range exploration:

```bash
cd agent
npx ts-node src/modbus_scan.ts 10.111.11.20 502 1 16384 16479 8
```

## Verified Register Candidates

| Register | Scale | Field | Example | Confidence | Notes |
| --- | ---: | --- | ---: | --- | --- |
| `4096` | `/10` | DC bus / battery voltage | `53.9 V` | High | Tracks SNMP bus/battery voltage. |
| `4097` | `/10` | DC load current | `45.3 A` | High | Tracks SNMP total load current. |
| `4102` | `/10` | AC L1 voltage | `205.2 V` | High | Tracks SNMP AC L1 voltage. |
| `4103` | `/10` | AC L2 voltage | `204.9 V` | High | Tracks SNMP AC L2 voltage. |
| `4104` | `/10` | AC L3 voltage | `0 V` / invalid | Medium | Site appears two-phase; invalid values should map to `0`. |
| `4105` | `/10` | AC L1 current | `6.1 A` | High | Tracks SNMP AC L1 current. |
| `4106` | `/10` | AC L2 current | `6.0 A` | High | Tracks SNMP AC L2 current. |
| `4107` | `/10` | AC L3 current | `0 A` / invalid | Medium | Site appears two-phase; invalid values should map to `0`. |
| `4108` | `x1` | AC frequency | `50 Hz` | Medium | Needs more samples; value is plausible. |
| `4352` | `/10` | Rectifier group total output current | `46.0 A` | High | Tracks SNMP `hwRectsTotalCurrent` (`164.1.3.1.3.0`). |
| `4353` | `x1` | Rectifier total quantity | `2 pcs` | High | Tracks SNMP `hwRectsTotalQuantity` (`164.1.3.1.4.0`). |
| `4355` | `x1` | Rectifier group total DC output power | `2453 W` | High | Tracks SNMP `hwRectsTotalDCPower` (`164.1.3.1.9.0`). |

## Rectifier Unit Candidates

SNMP comparison from KANTOR TEBING TINGGI currently reports two rectifier modules:

| SNMP Field | Rectifier1 | Rectifier2 | Notes |
| --- | ---: | ---: | --- |
| Output current | `23.0 A` | `23.5 A` | SNMP raw `230`, `235`, scale `/10`. |
| Output voltage | `54.0 V` | `53.9 V` | SNMP raw `540`, `539`, scale `/10`. |
| DC output power | `1245 W` | `1267 W` | SNMP raw watts. |
| AC input voltage | `206.4 V` | `206.3 V` | SNMP raw `/10`. |
| Temperature | `25.0 C` | `24.0 C` | SNMP raw `/10`. |
| Status | `1 normal` | `1 normal` | SNMP enum. |

Modbus candidates seen near `16384`:

| Register Block | Register | Scale | Candidate | Example | Confidence | Notes |
| --- | ---: | ---: | --- | ---: | --- | --- |
| `16384-16399` | `16387` | `/10` | Rectifier unit output current or related current | `24.6 A` | Medium | Near one module's SNMP output current, but not yet matched to module 1/2. |
| `16384-16399` | `16391` | `/100` | Rectifier unit output voltage | `53.86 V` | Medium | Tracks rectifier/system DC output voltage. |
| `16400-16415` | `16402` | unknown | Rectifier/status/temperature candidate | `77` | Low | Needs more samples or UI comparison. |
| `16400-16415` | `16403` | unknown | Packed/signed candidate | `47966` | Low | May be packed data; do not use yet. |

The `16384` area appears to require exact block reads; single-register reads return Modbus exception `2`.

## Alarm / Status Candidates

| Register Block | Register | Value | Candidate | Confidence | Notes |
| --- | ---: | ---: | --- | --- | --- |
| `12288-12303` | `12288` | `1` | Normal/running status candidate | Low | Needs a known alarm or state transition to verify. |
| `12336-12343` | `12339` | `50` | Frequency/status candidate | Low | Plausible but not enough evidence. |
| `36864-36879` | `36864` | `0` | Active alarm count/status candidate | Low | Current state appears no active alarm; cannot verify until an alarm is present. |
| `37024-37039` | `37024` | `0` | Alarm/status candidate | Low | Empty/no-alarm-like block. |

SNMP alarm/status comparison during this scan showed no obvious active alarm state in scalar status checks. The SNMP supported-alarm list is very large and includes entries such as `Northbound TCP-MODBUS Certificate Will Expire`, but that list is not the same as active alarms.

## Observed But Not Mapped

| Register | Example | Notes |
| --- | ---: | --- |
| `0` | `11` | Identity/status candidate. |
| `1` | `2` | Identity/status candidate. |
| `2` | `201` | Identity/status candidate. |
| `3` | `1045` | Identity/status candidate. |
| `4` | `2` | Identity/status candidate. |
| `8192` | `2026` | Unknown, `/10 = 202.6`; possible AC/rectifier input voltage candidate. |
| `8193` | `5` | Unknown status/current candidate. |
| `8194` | `8` | Unknown status/current candidate. |
| `8195` | `14` | Unknown status/current candidate. |
| `8196` | `41` | Unknown status/current candidate. |
| `8197` | `45` | Unknown status/current candidate. |
| `8208` | `33` | Unknown status candidate. |

## Range Scan Notes

| Range | Result | Notes |
| --- | --- | --- |
| `4096-4111` | Valid | Contains all currently mapped realtime DC/AC values. |
| `4112-4143` | Modbus exception `2` | Illegal data address; do not poll as a block. |
| `4352-4359` | Valid | Rectifier group totals live here. |
| `4360-4479` | Modbus exception `2` | Illegal data address in tested blocks. |
| `7168-7175` | Valid empty | No nonzero values during scan. |
| `8192-8215` | Valid | Unknown candidates, possibly AC/rectifier input/status. |
| `12288-12303` | Valid | Status candidate at `12288`. |
| `12336-12343` | Valid | Candidate at `12339`. |
| `16384-16399` | Valid | Rectifier unit candidates. |
| `16400-16415` | Valid | Low-confidence rectifier/status candidates. |
| `16432-16479` | Valid empty | No nonzero values during scan. |
| `36864-36879` | Valid empty/no-alarm-like | Candidate alarm/status block. |
| `37024-37039` | Valid empty/no-alarm-like | Candidate alarm/status block. |

## Current Agent Behavior

Local Docker enables Modbus for KANTOR TEBING TINGGI and POP TUNGKAL:

```yaml
MODBUS_SITE_IDS: "1,2"
MODBUS_PORT: 502
MODBUS_UNIT_ID: 1
```

When enabled, the agent reads the mapped realtime values from Modbus and still uses SNMP for lithium battery-bank detail (`walkBatteries`). If Modbus fails, the agent automatically falls back to SNMP for that poll cycle.

## Open Mapping Work

- Confirm register `4108` scaling and whether it is always frequency.
- Find AC/grid status register so outage detection can come from Modbus too.
- Verify rectifier unit mapping by comparing with Huawei UI per-rectifier page, especially `16387` and `16391`.
- Find battery aggregate status/SOC/capacity/temp registers, if exposed. Current lithium per-bank detail remains SNMP-only.
- Verify alarm/status registers during a controlled, safe alarm condition. Do not infer alarms from zero-only blocks.
- Decide whether per-cell lithium data should stay SNMP-only or be mapped through Modbus later.
