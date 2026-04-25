# Design Spec: Battery Monitoring Web App (NGalarm)

## 1. Overview
A web-based application to monitor Huawei Rectifiers and Battery Banks (5+ banks per site) across multiple locations using a hybrid SNMP agent architecture.

## 2. Architecture
- **Model:** Hybrid (Agent-based).
- **Site Agent:** Dockerized Node.js service at each site. Polls devices via SNMP and pushes data to Central Server.
- **Central Server:** Dockerized Node.js (Express) API + React Frontend.
- **Database:** PostgreSQL with TimescaleDB extension for time-series battery data.

## 3. Technology Stack
- **Backend:** Node.js (Express), `net-snmp` for polling.
- **Frontend:** React, Tailwind CSS, Recharts (for trending).
- **Database:** PostgreSQL + TimescaleDB.
- **Deployment:** Docker Compose (Service & Agents).

## 4. UI/UX Design
- **Home:** Grid view of all sites with color-coded health status.
- **Site Detail:** Schematic view showing Rectifier -> Busbar -> 5+ Battery Banks flow.
- **Trending:** Real-time graphs for Voltage and Current per bank.
- **Alerts:** Top-level notification bar for critical battery/rectifier alarms.

## 5. Data Model (Key Objects)
- **Sites:** ID, Name, Location.
- **Devices:** SiteID, IP, Community, Type (Huawei Enspire/Rectifier).
- **Metrics:** Timestamp, DeviceID, Object (Battery/Rectifier), Index (Bank #), Voltage, Current, Status.

## 6. SNMP OIDs (Identified from MIBs)
- Root: `1.3.6.1.4.1.2011.6.164.1`
- Batteries: `hwSiteBatterys` (OID: `...4`)
- Rectifiers: `hwRectifier` (OID: `...3.2`)
- Specifics: `hwBatteryDischarge`, `hwBatteryLowVoltage`, `hwRectifierStatus`.

## 7. Implementation Phases
1. **Phase 1:** Setup Central Server & Database + Mock Site Agent.
2. **Phase 2:** Implement Site Agent with real SNMP polling (Huawei MIB).
3. **Phase 3:** Develop React Dashboard (Grid & Schematic).
4. **Phase 4:** Dockerization and multi-site deployment testing.
