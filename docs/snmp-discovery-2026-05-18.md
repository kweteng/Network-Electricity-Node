# SNMP Discovery 2026-05-18

Local scan notes for Kerinci battery mapping and POP Server Tebing Tinggi ZTE discovery.

Raw scan files:

- `docs/snmp-scans/kerinci-164-17-2026-05-18.txt`
- `docs/snmp-scans/kerinci-164-18-2026-05-18.txt`
- `docs/snmp-scans/kerinci-164-full-2026-05-18.txt`
- `docs/snmp-scans/pop-server-tebing-zte-3902-2800-2026-05-18.txt`

## POP Kerinci

Target: `103.23.196.22:985`, community `Anekanet`.

Kerinci exposes the same Huawei lithium battery roots used by KANTOR TEBING TINGGI and POP TUNGKAL:

- ACB group root: `1.3.6.1.4.1.2011.6.164.1.17`
- Lithium bank root: `1.3.6.1.4.1.2011.6.164.1.18`

Useful live values from scan:

| Field | OID | Raw | Scale | Value |
| --- | --- | ---: | ---: | ---: |
| Battery group voltage | `1.3.6.1.4.1.2011.6.164.1.17.1.1.5.96` | 534 | `/10` | 53.4 V |
| Battery group current | `1.3.6.1.4.1.2011.6.164.1.17.1.1.6.96` | 0 | `/10` | 0.0 A |
| Battery capacity | `1.3.6.1.4.1.2011.6.164.1.17.1.1.7.96` | 1000 | `/10` | 100 Ah |
| Battery SOC | `1.3.6.1.4.1.2011.6.164.1.17.1.1.8.96` | 1000 | `/10` | 100% |
| Average temperature | `1.3.6.1.4.1.2011.6.164.1.17.1.1.9.96` | 289 | `/10` | 28.9 C |
| Backup time | `1.3.6.1.4.1.2011.6.164.1.17.1.1.11.96` | 205 | `/10` | 20.5 h |
| Charge status | `1.3.6.1.4.1.2011.6.164.1.17.1.1.12.96` | 1 | enum | float |
| Lithium bank voltage | `1.3.6.1.4.1.2011.6.164.1.18.2.1.1.3668` | 534 | `/10` | 53.4 V |
| Lithium bank capacity | `1.3.6.1.4.1.2011.6.164.1.18.2.1.5.3668` | 10000 | `/100` | 100 Ah |
| Cell voltages | `1.3.6.1.4.1.2011.6.164.1.18.2.1.{6..20}.3668` | 34 | `/10` | 3.4 V |
| Cell temperatures | `1.3.6.1.4.1.2011.6.164.1.18.2.1.{22..36}.3668` | 280-300 | `/10` | 28-30 C |

Decision: Kerinci should be `site_type='lithium'` so the agent walks `164.1.18.2.1` and stores per-cell `cells_json`, like other lithium POPs.

Web UI comparison supplied by user:

| Field | Web UI value | SNMP status |
| --- | --- | --- |
| Battery Voltage | 53.4 V | Matches `164.1.17.1.1.5.96` and `164.1.18.2.1.1.3668` |
| Battery Current | 0.0 A | Matches `164.1.17.1.1.6.96` and `164.1.18.2.1.2.3668` |
| Cell Package Voltage | 51.7 V | Not found as an exact live value in `2011.6.164` full walk |
| Cell Package Current | 0.0 A | Not separately mapped; bank current is 0.0 A |
| Battery SOC | 100% | Matches `164.1.17.1.1.8.96` |
| Cell temperatures | 28-30 C | Matches `164.1.18.2.1.{22..36}.3668` |
| Cell voltages | 3.43-3.45 V | SNMP public table exposes rounded raw `34` only, so dashboard can show about 3.4 V unless a higher-precision OID is found |
| Battery State | Charge / Float Charging | ACB status `164.1.17.1.1.12.96 = 1` maps to float |
| BMU Address | 1 | Lithium bank index `3668`, logical address `164.1.18.1.1.4.3668 = 1` |
| Capacity | 100.0 Ah | Matches ACB capacity and normalized bank capacity |
| Backup Time | 20.5 h | Matches `164.1.17.1.1.11.96` |
| Software Version | V120 | Matches `164.1.18.1.1.5.3668` |

AC/DC/rectifier web UI comparison supplied by user:

| Field | Web UI value | SNMP status |
| --- | --- | --- |
| AC L1/L2 voltage | 223.9 V / 222.8 V | Matches `164.1.5.2.1.1.4.1` and `.5.1` with `/10` scale |
| AC L1/L2 current | 0.6 A / 0.6 A | Matches `164.1.5.2.1.1.7.1` and `.8.1` with `/10` scale |
| AC L3 | N/A | Matches invalid sentinel `2147483647` on `.6.1` / `.9.1` |
| AC active power | 0.27 kW | Matches rectifier group total AC input power `164.1.3.1.11.0 = 271 W`; this is the verified AC-side source for PF |
| DC output voltage | 53.4 V | Matches `164.1.6.1.3.0 = 534` and DC output table `.6.2.1.1.4.1 = 534` |
| Total load current | 4.9 A | Matches `164.1.6.1.4.0 = 49` and DC output table `.6.2.1.1.5.1 = 49` |
| Total load power | 0.26 kW | Matches `164.1.6.1.5.0 = 260 W` and DC output table `.6.2.1.1.6.1 = 260 W` |
| Total load energy | 33536.29 kWh | Closest exposed SNMP values are `164.1.6.1.9.0 = 33583 kWh` and `.12.0 = 3358300`; exact web precision is not exposed through the verified public table |
| Rectifier group DC current | 4.5 A | Matches `164.1.3.1.3.0 = 45` with `/10` scale |
| Rectifier group output power | 237 W | Matches `164.1.3.1.9.0 = 237 W` |
| Rectifier group AC input power | 271 W | Matches `164.1.3.1.11.0 = 271 W` |
| Rectifier 1/2 current | 2.2-2.3 A | Matches `164.1.3.2.2.1.2.{28674,28675}` with `/10` scale |
| Rectifier 1/2 DC voltage | 53.4 V | Matches `164.1.3.2.2.1.3.{28674,28675}` with `/10` scale |
| Rectifier 1/2 DC power | 119-121 W | Matches `164.1.3.2.2.1.5.{28674,28675}` as live watts; values drift slightly by poll |
| Rectifier 1/2 AC input voltage | 222-223 V | Matches `164.1.3.2.2.1.6.{28674,28675}` with `/10` scale |
| Rectifier software/barcode | V806/V805 + serials | Matches config table `164.1.3.2.1.1.5.*` and `.8.*` |

Decision: Huawei AC PF can be calculated only when `164.1.3.1.11.0` is present, using `PF = AC input watts / apparent VA` where apparent VA is `sum(phase voltage * phase current)`. Clamp small rounding overshoot to `1.00`. If the AC-side power OID is absent or invalid, keep PF blank.

## POP Pematang LUMUT

Target: `10.111.11.52:161`, community `Anekanet`.

The controller was upgraded from standard Huawei SMU to SMU02C with two lithium banks. The site should now be `site_type='lithium'`.

Verified lithium tables:

- ACB group root: `1.3.6.1.4.1.2011.6.164.1.17.1.1`
- Lithium bank root: `1.3.6.1.4.1.2011.6.164.1.18`
- Bank indices: `3668` and `3669`

Key ACB values captured on 2026-05-24:

| Field | OID | Raw | Scale | Value |
| --- | --- | ---: | ---: | ---: |
| Group voltage | `164.1.17.1.1.5.96` | 544 | `/10` | 54.4 V |
| Group current | `164.1.17.1.1.6.96` | 0 | `/10` | 0.0 A |
| Total capacity | `164.1.17.1.1.7.96` | 2000 | `/10` | 200 Ah |
| Remaining capacity percent | `164.1.17.1.1.8.96` | 100 | `x1` | 100% |
| Temperature | `164.1.17.1.1.9.96` | 295 | `/10` | 29.5 C |
| Backup time | `164.1.17.1.1.11.96` | 251 | `/10` | 25.1 h |
| Charge state | `164.1.17.1.1.12.96` | 2 | enum | boost |

Bank table highlights:

| Bank | Index | Voltage | Current | SOH | Capacity | Cells | Temperatures |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Li Battery1 | 3668 | 54.5 V | 0.0 A | 94% | 100 Ah | 15 cells, about 3.50-3.55 V | about 30 C |
| Li Battery2 | 3669 | 54.4 V | 0.0 A | 100% | 100 Ah | 15 cells, about 3.45-3.54 V | about 29 C |

Note: this controller responds to sequential `GETNEXT` walks under `164.1.18` but may time out on the agent's bulk `subtree()` walk. The agent keeps `subtree()` for faster controllers and falls back to sequential `GETNEXT` when the subtree returns no battery rows.

## POP Server Tebing Tinggi

Target: `10.111.11.17:161`, community `public`.

Full ZTE enterprise scan:

- Root: `1.3.6.1.4.1.3902.2800`
- Rows captured: 1250
- Controller identity:
  - `1.3.6.1.4.1.3902.2800.1.2.1.1.253.0` = `ZXDU68 W201 V5.0`
  - `1.3.6.1.4.1.3902.2800.1.2.1.1.179.0` = `CSU501B`
  - `1.3.6.1.4.1.3902.2800.1.2.1.1.13.0` = serial `210088509821`

Useful values already mapped or strongly likely:

| Field | OID | Raw | Scale | Value |
| --- | --- | ---: | ---: | ---: |
| DC busbar voltage | `1.3.6.1.4.1.3902.2800.1.2.2.1.5.0` | 5350 | `/100` | 53.5 V |
| Battery SOC | `1.3.6.1.4.1.3902.2800.1.2.2.1.22.0` | 65 | `x1` | 65% |
| Battery temperature | `1.3.6.1.4.1.3902.2800.1.2.2.2.30.0` | 286 | `/10` | 28.6 C |
| AC L1 voltage | `1.3.6.1.4.1.3902.2800.1.2.3.2.15.1.2.1.1` | 218 | `x1` | 218 V |
| AC L2 voltage | `1.3.6.1.4.1.3902.2800.1.2.3.2.15.1.2.1.2` | 218 | `x1` | 218 V |
| AC L3 voltage | `1.3.6.1.4.1.3902.2800.1.2.3.2.15.1.2.1.3` | 218 | `x1` | 218 V |

Candidate values that need validation against the web UI or load change:

| Candidate | OID | Raw now | Notes |
| --- | --- | ---: | --- |
| Rectifier / module total current candidate | `1.3.6.1.4.1.3902.2800.1.2.3.1.3.0` | 808 | Could be 80.8 A; changed from older dump 825. Needs validation. |
| DC voltage candidate | `1.3.6.1.4.1.3902.2800.1.2.3.1.6.0` | 5350 | Same scale as busbar, likely duplicate/related. |
| Load/current candidate | `1.3.6.1.4.1.3902.2800.1.2.3.1.23.0` | 1117 | Could be 11.17 A or another measurement; needs validation. |
| SOC duplicate candidate | `1.3.6.1.4.1.3902.2800.1.2.3.1.54.0` | 65 | Matches current SOC. |
| AC frequency | `1.3.6.1.4.1.3902.2800.1.2.3.2.9.0` | 501 | Likely 50.1 Hz. |
| Battery string voltages/settings group | `1.3.6.1.4.1.3902.2800.1.2.2.4.{1..3}.0` | 5800,4800,4600 | Looks like threshold/settings group, not live telemetry. |

Alarm / dry-contact discovery:

- `1.3.6.1.4.1.3902.2800.1.2.2.1.240.1.2.*` exposes input states.
- `1.3.6.1.4.1.3902.2800.1.2.2.1.241.1.2.*` exposes labels, including:
  - `Main Fan Fail`
  - `TEC ALM`
  - `In-Relay-3#` through `In-Relay-16#`
- `1.3.6.1.4.1.3902.2800.1.2.2.1.242.1.2.*` exposes related numeric alarm/config values.

## POP TELNI

Target: `192.168.101.5:161`, community `public`.

Controller identity from the ZTE enterprise walk:

- `1.3.6.1.4.1.3902.2800.1.2.1.1.128.0` = `ZXDU(V5.0)`
- `1.3.6.1.4.1.3902.2800.1.2.1.1.179.0` = `CSU501B`
- `1.3.6.1.4.1.3902.2800.1.2.1.1.253.0` = `RACTI_SERVER_TELNI`
- Site label strings include `Teluk nilau`.

Values below were compared against the ZTE web UI data supplied by the user. Live values drift slightly by poll cycle, so exact raw values may differ by a few counts.

| Field | Web UI value | SNMP OID | Scale | SNMP status |
| --- | ---: | --- | ---: | --- |
| DC voltage | 54.00 V | `1.3.6.1.4.1.3902.2800.1.2.3.1.6.0` | `/100` | Matches |
| Load total current | 9.99 A | `1.3.6.1.4.1.3902.2800.1.2.3.4.2.0` | `/100` | Matches live drift (`1003` -> 10.03 A during scan) |
| Battery total current | 3.07 A | `1.3.6.1.4.1.3902.2800.1.2.3.1.4.0` | `/100` | Matches live drift (`297` -> 2.97 A during scan) |
| SMR total output current | 13.11 A | `1.3.6.1.4.1.3902.2800.1.2.3.1.3.0` | `/100` | Matches live drift (`1304` -> 13.04 A during scan) |
| AC frequency | 49.9 Hz | `1.3.6.1.4.1.3902.2800.1.2.3.2.9.0` | `/10` | Matches |
| AC L1/L2/L3 voltage | 171 V each | `1.3.6.1.4.1.3902.2800.1.2.3.2.15.1.2.1.{1,2,3}` | `x1` | Matches live drift (`177 V` during scan) |
| AC L1/L2/L3 current | 2 A / 2 A / 0 A | `1.3.6.1.4.1.3902.2800.1.2.3.2.16.1.2.1.{1,2,3}` | `x1` | Matches |
| Battery voltage 1/2 | 54.00 / 54.04 V | `1.3.6.1.4.1.3902.2800.1.2.3.4.4.1.2.1.{1,2}` | `/100` | Matches |
| Battery current 1/2 | 0.41 / 5.91 A | `1.3.6.1.4.1.3902.2800.1.2.3.4.5.1.2.1.{1,2}` | `/100` | Matches live drift (`0.12 A`, `2.94 A` during scan) |
| Battery SOC 1/2 | 100% / 100% | `1.3.6.1.4.1.3902.2800.1.2.3.4.14.1.2.1.{1,2}` | `x1` | Matches |
| Environment temperature | 37 C | `1.3.6.1.4.1.3902.2800.1.2.3.5.1.1.2.1.1` | `x1` | Matches |

Decision: use this TELNI-validated ZTE map for ZTE sites. The older POP Server Tebing Tinggi limitation still applies to fields that cannot be cross-checked there, but the shared OIDs are now promoted because TELNI web UI confirms their semantics.
