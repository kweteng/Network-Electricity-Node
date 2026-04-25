# Battery Monitoring (NGalarm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a functional prototype for monitoring Huawei rectifiers and battery banks across sites using a hybrid SNMP architecture.

**Architecture:** A Central Dashboard (Node.js + Postgres) collects data pushed from distributed Site Agents. Sites are visualized in a grid that expands to a power-flow schematic.

**Tech Stack:** Node.js, Express, React, Tailwind CSS, PostgreSQL/TimescaleDB, Docker, net-snmp.

---

### Task 1: Project Scaffolding & Docker Setup

**Files:**
- Create: `docker-compose.yml`
- Create: `server/Dockerfile`, `server/package.json`
- Create: `agent/Dockerfile`, `agent/package.json`
- Create: `frontend/Dockerfile`, `frontend/package.json`

- [ ] **Step 1: Create root Docker Compose file**
```yaml
version: '3.8'
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: ngalarm
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
  server:
    build: ./server
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://postgres:password@db:5432/ngalarm
  frontend:
    build: ./frontend
    ports:
      - "80:80"
```

- [ ] **Step 2: Initialize server and agent package.json**
Run in `server/` and `agent/`: `npm init -y && npm install express pg net-snmp dotenv` (plus devDeps for TS).

- [ ] **Step 3: Commit**
```bash
git add .
git commit -m "chore: initial project scaffolding and docker config"
```

---

### Task 2: Central Server Database & API

**Files:**
- Create: `server/src/db.ts`
- Create: `server/src/index.ts`
- Create: `server/src/routes/metrics.ts`

- [ ] **Step 1: Define database schema for sites and metrics**
```sql
CREATE TABLE sites (id SERIAL PRIMARY KEY, name TEXT, ip TEXT);
CREATE TABLE metrics (
  id SERIAL PRIMARY KEY,
  site_id INTEGER REFERENCES sites(id),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  device_type TEXT, -- 'rectifier' or 'battery'
  index INTEGER, -- bank or module index
  voltage FLOAT,
  current FLOAT,
  status TEXT
);
```

- [ ] **Step 2: Create API endpoint to receive data from agents**
```typescript
// server/src/routes/metrics.ts
router.post('/ingest', async (req, res) => {
  const { siteId, metrics } = req.body;
  // Insert into DB
  res.status(200).send({ success: true });
});
```

- [ ] **Step 3: Verify with a mock POST request**
Run: `curl -X POST http://localhost:3000/api/metrics/ingest -H "Content-Type: application/json" -d '{"siteId": 1, "metrics": []}'`
Expected: `{"success": true}`

- [ ] **Step 4: Commit**
```bash
git add server/
git commit -m "feat: server database schema and ingestion API"
```

---

### Task 3: Site Agent & SNMP Polling

**Files:**
- Create: `agent/src/snmp.ts`
- Create: `agent/src/index.ts`

- [ ] **Step 1: Implement SNMP poller using net-snmp**
```typescript
// agent/src/snmp.ts
import snmp from 'net-snmp';
const oids = {
  batteryVoltage: "1.3.6.1.4.1.2011.6.164.1.4.2.1.3", // Example OID from MIB analysis
};
// Function to poll and return data
```

- [ ] **Step 2: Add loop to push data to Central Server**
```typescript
// agent/src/index.ts
setInterval(async () => {
  const data = await pollSnmp();
  await pushToServer(data);
}, 30000); // 30 seconds
```

- [ ] **Step 3: Run agent with provided credentials and verify logs**
Credentials: `10.111.11.20`, community `Anekanet`.

- [ ] **Step 4: Commit**
```bash
git add agent/
git commit -m "feat: site agent with snmp polling logic"
```

---

### Task 4: Frontend Dashboard (React)

**Files:**
- Create: `frontend/src/components/SiteGrid.tsx`
- Create: `frontend/src/components/SchematicView.tsx`

- [ ] **Step 1: Build Site Grid with health status**
- [ ] **Step 2: Build Schematic Detail for 5+ Battery Banks**
- [ ] **Step 3: Connect to Server API to fetch real-time metrics**

- [ ] **Step 4: Commit**
```bash
git add frontend/
git commit -m "feat: react dashboard with grid and schematic views"
```
