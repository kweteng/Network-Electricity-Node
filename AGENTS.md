# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

NEN (Network Electricity Node) is a multi-vendor SNMP monitoring system for Rectifiers and Battery Banks across multiple POP locations. It has three services:

- **`frontend/`** — React 19 + Vite + TypeScript + Tailwind CSS (port 3002)
- **`server/`** — Express 5 + TypeScript + PostgreSQL REST API (port 3001)
- **`agent/`** — Node.js + TypeScript SNMP polling daemon (runs on interval, no HTTP port)

## Commands

### Development (local, without Docker)

Start Postgres first:
```bash
docker compose up db -d
```

Then run each service in separate terminals:
```bash
# Backend
cd server && npm start

# Frontend
cd frontend && npm run dev

# Agent
cd agent && npm start
```

### Docker (full stack)
```bash
docker compose up --build
```

### Docker (production target)
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```
Production override is intentionally more conservative than local Docker: frontend is built and served with Vite preview, server/agent run compiled JavaScript, DB/server healthchecks gate startup order, and the agent starts after a delay with a slower poll interval.

### Build frontend for production
```bash
cd frontend && npm run build
```

### Testing & Linting
There are **no tests and no linter** configured. `npm test` in `server/` and `agent/` is a stub that exits 1. Don't waste time looking for a Jest/Vitest/ESLint config — there isn't one.

## Architecture

### Data Flow
```
SNMP/optional local Modbus devices → Agent → POST /api/metrics/ingest → Server → PostgreSQL
                                                                                    ↓
                         Frontend ← GET /api/metrics/latest ← latest_metrics snapshot
                         Hermes  ← GET /api/hermes/summary, /sites, /sites/:id
```

### Authentication
A hardcoded bearer token (`nen-v2-token`) is used. The frontend stores it in `localStorage` under `nen_token`. The server's `requireAuth` middleware validates it. The default password is `admin`.

### Database Schema (auto-created on server start)
`initDb()` in [server/src/db.ts](server/src/db.ts) creates the `sites`, `devices`, `metrics`, and `latest_metrics` tables, then seeds all 6 POPs if the `sites` table is empty. `metrics` stores history; `latest_metrics` is a compact realtime snapshot keyed by `(site_id, device_type, index)` and is updated by `/api/metrics/ingest`. `/api/metrics/latest` and Hermes status APIs should read from `latest_metrics` so dashboard/agent integrations do not scan the full history table. It drops/recreates tables only when `INIT_DB_RESET=true`; never enable that in production.

### Hermes Status API
Hermes integrations should use the summarized APIs instead of raw metrics:
- `GET /api/hermes/summary` — fleet totals, alarms, and per-site realtime status.
- `GET /api/hermes/sites` — per-site realtime status list.
- `GET /api/hermes/sites/:id` — one site status.

All Hermes endpoints require `Authorization: Bearer nen-v2-token`. Responses include grid state, AC phase V/A, AC frequency, AC apparent kVA/PF when available, DC load W/kW/A, battery SOC/capacity/backup time/current/state, stale-data status, and alarm severity.

### Add POP Workflow
The dashboard Add POP flow is guarded by a server-side SNMP probe:
- `POST /api/sites/probe` checks sysDescr and vendor-specific candidate OIDs, then returns reachability, vendor, suggested site type, and whether the POP can be saved.
- `POST /api/sites` refuses duplicate names/IPs and requires a successful probe before saving the site/device pair.
- Huawei lithium detection should treat the ACB SOC table as a lithium-capable signal even when bank table indices vary between controllers.

### Vendor Logic (agent/src/snmp.ts)
Three polling paths based on `site.site_type`:
- **`lithium`** — Huawei Enspire: polls common OIDs via `pollRealData()`, then does a full battery bank subtree walk via `walkBatteries()` (indices vary by controller, e.g. Tebing `3669–3675`, Kerinci `3668`). Per-cell voltage/temperature comes from `164.1.18.2.1` columns `6..20` / `22..36`, stored as `metrics.cells_json`. Column `4` in that table is SOH, not SOC; lithium SOC comes from ACB group `164.1.17.1.1.8` (remaining-capacity percent) until a verified per-bank SOC OID is mapped. Battery backup time comes from ACB group `164.1.17.1.1.11` as hours with one decimal.
- **`standard`** — Huawei SMU: polls common OIDs only (no per-bank walk); battery is a single aggregate row.
- **`zte`** — ZTE ZXDU68: uses ZTE-specific OIDs via `pollZteData()`. TELNI-validated DC voltage, load current, battery current, and SMR current use `/100`; AC voltage/current are raw; AC frequency uses `/10`.

For Huawei sites without the ACB table, backup time falls back to `164.1.4.2.2.0` (`hwBattsPreDischargeTime`) in minutes, normalized into `metrics.backup_time_h`.

Huawei AC input table column 11 is a voltage threshold, not active power. AC apparent power remains estimated from `Σ phase V × phase A` and is shown as kVA. When `hwRectsTotalACInputPower` (`164.1.3.1.11.0`) is exposed, AC PF is calculated from this verified AC-side watts value divided by apparent VA, clamped to `1.00` for small live rounding overshoot. Do not derive AC PF from DC output/load data.

SNMP values returning `NoSuchName` or `0x7FFFFFFF` are resolved to `"0"` in `getSingleOid()`.

### Local TCP Modbus Work
TCP Modbus support is currently local-only for KANTOR TEBING TINGGI (`10.111.11.20:502`) and experimental for POP TUNGKAL (`10.113.13.52:502`), unit `1`, function `03` holding registers. The working register map is documented in [docs/modbus-huawei-enspire-mapping.md](docs/modbus-huawei-enspire-mapping.md). Local Docker can enable this path with `MODBUS_SITE_IDS="1,2"`; if Modbus fails, the agent falls back to SNMP for that cycle. Do not deploy or enable Modbus polling on the remote production host without an explicit user command.

### Frontend (frontend/src/App.tsx)
The current dashboard intentionally mirrors the handoff prototype at [nen/NEN Dashboard _standalone_.html](nen/NEN%20Dashboard%20_standalone_.html): dark command-center shell, summary strip, network node cards, desktop selected-node detail panel, and mobile bottom-sheet detail. State includes `token`, `theme` (`nen_design_theme`), `metrics`, `history`, `sites`, `devices`, selected site, local maintenance toggles, `siteViewMode`, and draft Telegram alert settings. Polling defaults to 30 seconds via `VITE_POLL_INTERVAL_MS`.

The header Settings button opens a local settings modal with General, Notifications, Nodes, Runtime, and About sections. Telegram notification settings currently live as a frontend draft in `localStorage` (`nen_telegram_settings`) and must not store bot tokens in the browser. Live Telegram delivery should be implemented server-side with `TELEGRAM_BOT_TOKEN` in environment variables, DB-backed channels/rules, cooldown/recovery state, and a test-send endpoint.

### Styling setup (important)
The dashboard CSS lives in [frontend/src/index.css](frontend/src/index.css), ported from the standalone design bundle. Tailwind CDN was removed from [frontend/index.html](frontend/index.html); there is no `tailwind.config.js`, no PostCSS pipeline, and no `tailwindcss` npm dependency. Add visual changes in `index.css` and the inline component styles in `App.tsx`, keeping the standalone file as the visual reference.

### Data Retention
`server/src/cleanup.ts` runs on startup and every 12 hours to delete metrics older than 30 days.

## Key Configuration

### Environment Variables
- **server/.env**: `DATABASE_URL`, `PORT` (default 3001)
- **server/.env**: `CORS_ALLOWED_ORIGINS` comma-separated browser origins allowed to call the API. Empty/unset allows all origins for local development.
- **server/.env**: `INIT_DB_RESET` must stay `false`/unset in production. Set `true` only for local prototype resets because it drops all tables.
- **agent/.env**: `SERVER_URL` (default `http://localhost:3001`)
- **agent/.env**: `POLL_INTERVAL_MS`, `POLL_INITIAL_DELAY_MS`, `REQUEST_TIMEOUT_MS` tune production polling load. Remote production currently uses a 60s interval and 30s initial delay.
- **agent/.env**: `MODBUS_SITE_IDS`, `MODBUS_PORT`, `MODBUS_UNIT_ID`, `MODBUS_TIMEOUT_MS` are for local Modbus experiments. Keep unset in production unless explicitly requested.
- **frontend/.env**: `VITE_API_BASE_URL` (default `http://localhost:3001`; remote production uses `http://103.154.178.52:3003`; domain access should point to the public API/reverse-proxy URL, not browser-local `localhost`)
- **frontend/.env/build args**: `VITE_MODBUS_SITE_IDS` and `VITE_MODBUS_PORT` only affect the UI source badge/endpoint display. Local Docker sets `"1,2"`/`502`; production override keeps it empty unless explicitly requested.

### Ports
- Local/dev Docker: DB 5432, Server 3001, Frontend 3002.
- Remote production (`docker-1-atj`): Frontend 3002, Server API 3003, DB internal only (not exposed) because remote 5432/3001 are already used by other services.

### Deployment Target
- Host: `docker-1-atj` / `103.154.178.52`, SSH user `root`, host reports `DOCKER-DEB`.
- Docker and Docker Compose are installed on the target. Preferred deploy path: `/opt/nen`.
- Production compose command: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`.
- Public URLs: frontend `http://103.154.178.52:3002`, API `http://103.154.178.52:3003`.
- Domain: `nen.tbg.aneka.net.id` is allowed in Vite dev/preview host checks and in production CORS origins.
- Use `scp`/tar if `rsync` is unavailable on the remote.
- Mandatory workflow: do not upload, deploy, restart, or otherwise change this remote host unless the user gives an explicit deploy/host command in the current conversation turn.

## Reference Material

- **[mibs/](mibs/)** — vendor MIB files (`HUAWEI-MIB.mib`, `emap_snmp.mib`). Source of truth for SNMP OIDs when adding/debugging vendor support.
- **[design-system/network-electricity-node/MASTER.md](design-system/network-electricity-node/MASTER.md)** and `pages/` — visual/design reference for the dashboard.
- **[docs/superpowers/plans/](docs/superpowers/plans/)** and **`specs/`** — implementation plans and specifications produced via the superpowers workflow. Check here before starting non-trivial work.
- **[GEMINI.md](GEMINI.md)** — additional product/UI mandates (visual identity, vendor logic notes, roadmap). Treat as authoritative for product decisions.
- Top-level `*_sys.txt`, `*_bat.txt`, `lithium*.txt` files are raw SNMP walk dumps captured from real devices — useful when reverse-engineering OID semantics.

## Future Architecture Options

**Live cell-detail drill-down (deferred).** Current per-cell battery data is stored as a JSONB snapshot in `metrics.cells_json`, refreshed every poll cycle. An alternate architecture, deferred for now:

- Frontend opens battery diagnostic → calls a new server endpoint `/api/diagnostic/cells?siteId=X` → server forwards a live request to the agent → agent walks cell OIDs on demand → returns JSON.
- Pros: zero storage cost for cell data, always fresh on click.
- Cons: requires a request/response channel from server back to agent (currently agent only POSTs upstream), adds RTT delay on modal open, more moving parts.
- Switch to this if `cells_json` storage becomes a problem or freshness on click matters more than ambient sampling.

## UI Overhaul Todo

Work locally first. Do not upload, deploy, restart, or otherwise change the production host for this UI overhaul unless the user gives an explicit deploy/host command in the current turn.

- [ ] Replace the current schematic-first dashboard cards with status-first cards that remain stable at mobile, tablet, and desktop widths.
- [ ] Remove important telemetry from fragile absolute-positioned nodes; use grid/flex regions for AC, DC/load, battery, and metadata.
- [ ] Desktop layout: build a command-center view with summary counters, a dense site list/grid, and a selected-site detail panel.
- [ ] Mobile layout: use a single-column vertical stack, compact cards, and bottom-sheet style details; avoid horizontal page overflow.
- [ ] Keep schematic flow as a detail/secondary visualization rather than the default mobile card surface.
- [ ] Redesign graph diagnostics into separate AC, DC/load, battery, and alarm timeline views with clear legends and range controls.
- [ ] Split `frontend/src/App.tsx` into focused components (`AppShell`, `SummaryBar`, `SiteCard`, `SiteDetail`, `MetricChart`, diagnostic modals) plus metric-formatting helpers.
- [ ] Verify responsive breakpoints at 375px, 768px, 1024px, and 1440px with the in-app browser before considering the UI ready.
- [ ] Preserve current telemetry semantics: estimated apparent power stays kVA, PF stays approximate unless a verified active-power OID is found, and unsupported ZTE values render as `—`.

## Engineering Constraints

- **Never hardcode IPs in the agent** — always read from the DB via `/api/sites` and `/api/devices`.
- **SNMP ports** — devices have a `port` column. Default is `161`; POP KOMINFO Merangin uses SNMP on `103.154.178.110:8091`; POP Kerinci uses SNMP on `103.23.196.22:985`.
- **SNMP scale factors** — Huawei voltages may arrive at `×1`, `×10`, or subtree-only; ZTE busbar is `÷100`, currents are `÷10`. Always apply the correct divisor before ingestion.
- **Huawei backup time** — ACB group `164.1.17.1.1.11` is hours with one decimal (`÷10`); scalar `164.1.4.2.2.0` is minutes (`÷60`). Store normalized hours in `metrics.backup_time_h`.
- **Kerinci lithium mapping** — POP Kerinci exposes Huawei ACB group `164.1.17` and lithium bank table `164.1.18` on SNMP `103.23.196.22:985`, including bank index `3668`, SOC, backup time, 15 cell voltages, and 15 cell temperatures. Keep it as `site_type='lithium'`.
- **Pematang lithium mapping** — POP Pematang LUMUT (`10.111.11.52:161`, community `Anekanet`) is now SMU02C with two lithium banks (`3668`, `3669`). It exposes the same Huawei ACB/lithium roots as other SMU02C sites, but may require the sequential `GETNEXT` fallback for `164.1.18` because bulk subtree walking can time out.
- **ZTE ZXDU68 mapping:** POP TELNI (`192.168.101.5:161`, community `public`) validates the shared ZTE map for AC phase V/A, AC frequency, DC load current, battery total current, SMR output current, and per-bank voltage/current/SOC. POP Server Tebing Tinggi uses the same ZTE path, but values that cannot be cross-checked there should still be treated carefully. Discovery notes are in `docs/snmp-discovery-2026-05-18.md`.
- **Huawei AC power factor** — PF must come from a verified AC-side active-power/PF source. Current verified Huawei source is rectifier group `hwRectsTotalACInputPower` (`164.1.3.1.11.0`) divided by AC apparent VA (`Σ phase V × phase A`). Do not compute PF from rectifier DC output or DC load. Leave PF blank when the AC-side power OID is missing or invalid.
- **Invalid Huawei AC polls** — if a Huawei AC subtree read returns all phase voltages as `0`, skip ingesting that AC row so a transient timeout does not overwrite the last valid reading with a false AC failure.
- **Modbus local-only status** — Huawei TCP Modbus mapping is still under local development. Keep SNMP fallback enabled and do not treat unknown registers as verified telemetry.
- **Production DB safety** — `initDb()` only drops tables when `INIT_DB_RESET=true`. Never set this in production.
- **Production load safety** — do not run the frontend with the Vite dev server on the Docker host. Production must use the compiled/preview Dockerfile path and the slower agent interval from `docker-compose.prod.yml`.

---

## RESUME POINT — 2026-04-28 (delete this section once feature ships)

### Where we are
- **Branch:** `feat/card-detail-enhancement` (created, no commits yet)
- **Spec:** [docs/superpowers/specs/2026-04-28-card-detail-enhancement-design.md](docs/superpowers/specs/2026-04-28-card-detail-enhancement-design.md)
- **Plan:** [docs/superpowers/plans/2026-04-28-card-detail-enhancement.md](docs/superpowers/plans/2026-04-28-card-detail-enhancement.md) — 9 tasks (T1–T9)
- **Stack state at pause:** `nen-db-1` was started via `docker compose up db -d`. Server, agent, frontend not started. May be stopped now — verify with `docker ps`.

### Goal recap
Bring dashboard card to feature parity with Huawei Enspire web UI: 3-phase V+A and total AC W under the lightning icon, dominant kW under the PDC node, per-cell capacity/ΔV/temp summary under the battery icon + drill-down per cell in the modal. Fix bogus 1A ZTE load reading.

Architecture choice (Approach 1 from spec): agent polls everything every 10s, summary fields stored in existing `metrics` columns, full per-cell snapshot stored as JSONB `cells_json`. No new endpoints, no new services.

### Todo state (10 items)
- [x] **(skill bootstrap)** Brainstorm + spec written + plan written + branch created
- [ ] **T1 step 1** — Write `agent/src/probe_cells.ts` (script body specified verbatim in plan)
- [ ] **T1 step 2–4** — User runs probe against `10.111.11.20` and reports cell-V and cell-temp OID prefixes; commit script
- [ ] **T2** — Extend DB schema (`server/src/db.ts` + `server/src/index.ts` INSERT) with `ac_i_l1/l2/l3` and `cells_json` columns
- [ ] **T3** — Agent Huawei AC distribution full subtree walk (`getHuaweiAcDistribution` in `agent/src/snmp.ts`)
- [ ] **T4** — Agent lithium per-cell walk (extend `walkBatteries`); requires T1 output to fill `<DISCOVERED_FROM_T1>` placeholders
- [ ] **T5** — Agent standard-site capacity passthrough (`battRemainAh` from `164.1.4.2.9.0`)
- [ ] **T6** — Frontend card layout (Mains node V/A per phase, PDC dominant kW, battery capacity/ΔV/temp lines)
- [ ] **T7** — Frontend modal extensions (Mains modal: I per phase + freq + active power; Battery modal: click-to-expand per-cell grid)
- [ ] **T8** — ZTE load current investigation: grep `mibs/emap_snmp.mib`, probe candidate OIDs on `10.111.11.17`, fix or fall back to `—`
- [ ] **T9** — End-to-end verification across all 6 POPs

### Critical gating points (do NOT skip)
1. **T1 → T4 dependency:** T4 has `<DISCOVERED_FROM_T1>` placeholders for the cell-V and cell-temp OID prefixes. T4 cannot be implemented until T1 step 2 output is in hand.
2. **T8 needs live access** to `10.111.11.17`. If unreachable, follow T8's documented fallback (display `—` and append a note to `AGENTS.md` Engineering Constraints).
3. **`initDb()` drops tables on every server restart** — verifications in T2/T3/T4 require running the agent for at least one 10-second polling cycle after server is started, otherwise DB is empty.

### Resume protocol for next Codex session

**Step A — restore context:**
```bash
git status                                    # confirm on feat/card-detail-enhancement
git log --oneline -5                          # see what (if any) tasks already committed
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep nen-db
```

If `nen-db-1` is not running:
```bash
docker compose up db -d
until docker exec nen-db-1 pg_isready -U postgres -d nen >/dev/null 2>&1; do sleep 1; done
```

**Step B — re-read the plan:** open `docs/superpowers/plans/2026-04-28-card-detail-enhancement.md` and find the first unchecked task.

**Step C — resume execution:**
- If still at T1 step 1: write `agent/src/probe_cells.ts` exactly as specified in the plan, commit, then ask user to run the probe and report results.
- If T1 output is already provided: substitute the OID prefixes into T4's `CELL_V_BASE` / `CELL_TEMP_BASE` constants and proceed sequentially through T2 → T9.
- For each task, follow the plan's steps verbatim — they're bite-sized and include verification commands.

**Step D — psql access:** `psql` is NOT in PATH on this machine. Use the docker-internal client instead:
```bash
docker exec -i nen-db-1 psql -U postgres -d nen -c "SELECT ..."
```
Substitute this form everywhere the plan says `psql postgres://...`.

**Step E — running services for verification:**
```bash
# Terminal 1 (server): cd server && npm start
# Terminal 2 (agent):  cd agent && npm start
# Terminal 3 (web):    cd frontend && npm run dev
```
Use `Bash run_in_background: true` for these. Don't sleep-poll; the agent logs each polling cycle.

**Step F — finish:** after T9 passes, invoke `superpowers:finishing-a-development-branch` skill to close out the work (decide on PR / merge strategy with the user).

### Things to ask the user when resuming
- Did the probe (T1 step 2) get run? If yes, paste the output.
- Is the ZTE device (`10.111.11.17`) reachable, or should T8 go straight to fallback?
- Is the dev session resuming on the same machine (Docker daemon, ports 5432/3001/3002 free)?
