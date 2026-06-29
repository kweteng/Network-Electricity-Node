# Hermes API

Hermes should call the summarized NEN endpoints instead of raw metrics. These endpoints read from `latest_metrics`, a compact realtime snapshot table, so calls stay fast even when historical `metrics` data grows.

## Auth

All endpoints require:

```http
Authorization: Bearer nen-v2-token
```

## Endpoints

### Fleet Summary

```http
GET /api/hermes/summary
```

Use this for questions like "status kelistrikan Aneka gimana?".

Response shape:

```json
{
  "service": "NEN",
  "description": "Network Electricity Node realtime power status",
  "updatedAt": "2026-05-26T04:56:48.000Z",
  "totals": {
    "sites": 7,
    "gridActive": 6,
    "gridFailure": 1,
    "stale": 0,
    "activeAlarms": 1,
    "totalDcLoadKw": 7.82,
    "averageBatterySoc": 98
  },
  "alarms": [],
  "sites": []
}
```

### All Sites

```http
GET /api/hermes/sites
```

Use this when Hermes needs to compare all POPs.

### One Site

```http
GET /api/hermes/sites/:id
```

Use this for questions like "battery Tebing tinggal berapa jam?".

## Site Status Fields

Each site object includes:

- `status`: `GRID_NORMAL`, `AC_INPUT_FAILURE`, `ON_BATTERY`, or `NO_RECENT_DATA`
- `alarmLevel`: `normal`, `warning`, or `critical`
- `updatedAt` and `ageSeconds`
- `ac`: online state, phase voltage/current, frequency, apparent kVA, and PF when available
- `dcLoad`: watts, kW, amps, and bus voltage
- `battery`: SOC, bank count, capacity Ah, voltage, current, power watts, backup time, state, and temperature range

## Example Call

```bash
curl -s http://103.154.178.52:3003/api/hermes/summary \
  -H 'Authorization: Bearer nen-v2-token'
```
