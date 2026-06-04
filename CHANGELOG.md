# Changelog

## Upcoming

- Added `POP PURWODADI` as a Huawei lithium site at `10.111.11.123:161` after SNMP probe confirmed Huawei ACB and lithium bank data.
- Upgraded Add POP into a guarded workflow with SNMP probe support, vendor/site-type selection, SNMP port/community fields, duplicate checking, and save blocked until probe succeeds.
- Changed the network nodes toolbar from a placeholder `Grid` button into a real Grid/List view toggle for easier scanning as the POP count grows.
- Added server-backed Telegram alert test sending via `/api/alerts/telegram/test`, with status discovery, server environment token support, and one-time test-token support that is not stored in the browser.
- Fixed the mobile dashboard header so the NEN brand, live metadata, Alarms, Settings, and theme actions collapse into a compact two-row layout instead of wrapping vertically.
- Added a local Telegram alert settings menu with channel/chat settings, rule toggles, thresholds, cooldown, backend test send, and live message preview from active dashboard alarms.
- Added a local Settings page modal with General, Notifications, Nodes, and Runtime sections; Telegram alert settings now have a proper settings entry point.
- Added an About section to Settings with NEN identity, operational purpose, system principles, and stack notes.
- Added `latest_metrics`, a small realtime snapshot table maintained during ingest, so `/api/metrics/latest` no longer scans the full history table.
- Added Hermes-facing status APIs: `/api/hermes/summary`, `/api/hermes/sites`, and `/api/hermes/sites/:id`, all protected by the existing `Bearer nen-v2-token` auth.
- Hermes responses summarize grid status, AC phases, DC load, battery SOC/capacity/backup time, stale data, and alarms in a directly consumable JSON shape.
- Reclassified `POP Pematang LUMUT` (`10.111.11.52`) as Huawei lithium after the site was upgraded to SMU02C with two lithium banks.
- Added a Huawei lithium battery-walk fallback from `subtree()` to sequential `GETNEXT`, needed for controllers that expose `164.1.18` but time out on bulk subtree walking.
- Added the same sequential `GETNEXT` fallback for Huawei AC distribution reads, preventing SMU02C subtree timeouts from rendering a false AC failure row.
- Cleaned stale pre-lithium aggregate battery rows for `POP Pematang LUMUT` so `/api/metrics/latest` uses only the real lithium bank rows.
- Added `POP TELNI` as a ZTE ZXDU68 site at `192.168.101.5:161` and cleaned the duplicate production entries that were created with wrong IP/type metadata.
- Validated ZTE TELNI SNMP readings against the ZTE web UI and promoted the matching ZTE OIDs for AC phase V/A, AC frequency, DC load current/power, battery total current, per-bank voltage/current/SOC, and SMR output current.
- Updated ZTE polling so validated ZTE sites can show real DC load and battery data instead of the legacy blank-load fallback used for the older POP Server Tebing Tinggi discovery.

- Implemented the `NEN Dashboard _standalone_.html` command-center layout in the React dashboard, including the dark grid shell, summary strip, node cards, selected-node detail panel, mobile bottom sheet, source badges, compact power-flow cards, and battery cell map styling.
- Added SNMP battery backup-time ingestion end to end: Huawei ACB group backup time (`164.1.17.1.1.11`, hours ×10) and scalar pre-discharge time (`164.1.4.2.2.0`, minutes) are normalized into `metrics.backup_time_h` and shown in cards/detail views.
- Added local/prod frontend build args for Modbus source badges so local Docker can show POP Tebing/Tungkal as `MODBUS :502` while production stays SNMP-only unless explicitly enabled.
- Updated seeded POP location metadata to match the real node names used by the new selected-node detail panel.
- Planned a local-first NEN dashboard UI overhaul focused on stable responsive layout, better mobile readability, and richer graph diagnostics.
- Planned to replace the current oversized schematic-first card with compact status-first site cards plus a dedicated detail view for schematic, AC, DC/load, battery, and alarms.
- Planned chart redesign with separate AC, DC/load, battery, and alarm timeline views, including responsive mobile sizing and range controls.
- Corrected Huawei AC PF semantics: AC power factor is now blank unless a verified AC-side source is mapped, and the UI no longer shows PF under DC load.
- Updated dashboard battery SOC aggregation to use capacity-weighted SOC when per-bank capacity is available, matching lithium group behavior more closely.
- Corrected Huawei lithium bank mapping: `164.1.18.2.1.4` is SOH, not SOC, so lithium SOC now uses the verified group remaining-capacity percent instead of showing SOH as SOC.
- Corrected Huawei ACB group summary mapping: `164.1.17.1.1.7` is total capacity and `.8` is remaining capacity percent/SOC.
- Added local dashboard power-flow animations for grid supply, AC outage alert state, and battery-discharge/load-from-battery state.
- Tightened the dashboard mobile layout so summary cards, site cards, and detail tiles use bounded grid columns instead of overflowing the viewport.
- Added an `EST PF` display using the operational `kW/kVA` ratio while keeping real `AC PF` reserved for a verified AC-side PF source.
- Fixed Huawei lithium SOC normalization for controllers that report remaining capacity as `100` instead of `1000`, restoring POP Tungkal from `10%` to `100%`.
- Removed the sweeping blue card animation and replaced it with static AC/PDC/load and battery/PDC path indicators that change color based on the active source.
- Changed mobile selected-node details into a bottom-sheet popup while keeping the desktop detail panel.
- Reintroduced motion only inside the small power-path connector lines, and reversed the battery detail flow so discharge animation moves upward from battery toward the load path.
- Reclassified POP Kerinci as Huawei lithium after SNMP discovery confirmed ACB group `164.1.17` plus lithium bank table `164.1.18` with SOC, backup time, capacity, and 15 cell voltage/temperature readings.
- Added `docs/snmp-discovery-2026-05-18.md` with Kerinci battery mapping and POP Server Tebing Tinggi ZTE full-scan findings, including candidate ZTE current/load/alarm OIDs that still need validation before production telemetry use.
- Normalized Huawei lithium bank capacity values reported as `10000` so Kerinci's 100Ah pack does not render as 1000Ah.
- Cross-checked POP Kerinci SNMP readings against the Huawei web UI battery page; all major battery fields match, while public SNMP currently exposes rounded cell voltage values only (`3.4V` versus web UI `3.43-3.45V`).
- Verified POP Kerinci AC/DC distribution and rectifier group/unit OIDs against the Huawei web UI, including AC phase V/A, DC load power/current, rectifier output watts, AC input watts, software versions, and serial numbers.
- Added Huawei rectifier unit polling so the detail panel can show real rectifier telemetry instead of synthesized unit tiles when SNMP exposes `164.1.3.2`.
- Enabled real Huawei AC PF when `hwRectsTotalACInputPower` (`164.1.3.1.11.0`) is available, using the verified AC-side input watts divided by estimated apparent VA.
- Added a Kerinci migration cleanup to remove stale pre-lithium aggregate battery rows from `/api/metrics/latest`, preventing duplicate SOC/capacity after the site type change.

## 2026-05-08

- Added local-only Huawei Enspire TCP Modbus probing/mapping utilities.
- Documented initial Modbus register map for POP Tebing Tinggi, including realtime DC/AC telemetry, rectifier group totals, rectifier unit candidates, and alarm/status candidates.
- Enabled local Docker Modbus polling only for POP Tebing Tinggi with SNMP fallback; production remains unchanged.
- Reduced local runtime load by adding Docker resource limits, slowing frontend polling, and quieting default ingest/poll logs.

## 2026-05-07

- Hardened production Docker runtime to reduce host CPU pressure: frontend now builds before serving, server/agent run compiled JavaScript, DB/server healthchecks gate startup order, and agent polling is configurable with a slower production interval.
- Made destructive database reset opt-in via `INIT_DB_RESET=true` so production restarts do not drop and recreate all tables.
- Added `POP Kerinci` as a Huawei standard SMU site at `103.23.196.22:985`.
- Added Huawei standard battery summary polling from the ACB group table for POP Kerinci-style SMUs, including SOC, total capacity, temperature, and charge status.
- Renamed the project branding to NEN (Network Electricity Node) across the frontend, server, agent, Docker Compose configuration, and project documentation.
- Updated auth/storage/export identifiers to `nen_*` / `nen-v2-token`.
- Renamed the design-system reference path to `design-system/network-electricity-node`.

## 2026-04-29

- Added Huawei AC power factor storage/display plumbing end-to-end.
  - Server stores `metrics.ac_power_factor` and wires it through `/api/metrics/ingest`.
  - Frontend can show AC PF in AC diagnostics when a verified AC-side source is available.
  - PF remains blank until a verified AC active-power/PF OID or register is mapped.
- Corrected Huawei AC column interpretation: AC input table column 11 is a voltage threshold, not active power. Until a verified real active-power OID is found, the UI shows estimated apparent power (`Σ V x A`) as kVA and leaves PF blank.
- Added Huawei lithium per-cell snapshots from `164.1.18.2.1` table columns:
  - Cell voltage columns `6..20`
  - Cell temperature columns `22..36`
  - Full per-bank snapshots are stored in `metrics.cells_json`.
- Added AC phase current columns and JSONB cell storage to metrics.
- Replaced unsupported ZTE real-time load/current display with `—` instead of the bogus `1.0A` reading.
- Fixed intermittent POP TUNGKAL false AC failure by skipping invalid Huawei AC rows where all phase voltages are `0` after a timeout/failed subtree read, preserving the last valid AC reading.
- Clarified dashboard labels for `LOAD` current versus `BATT` current. POP TUNGKAL lithium banks currently report `0A` on bank current OIDs while the PDC/load current OID reports about `8.6A`.
