# Telegram Alert Menu Proposal

NEN can add Telegram push notifications as a first-class alert menu. The goal is to notify operations only when a site needs attention, without spamming repeated messages every polling cycle.

## Current Local UI Status

The dashboard now has Telegram settings in the top-level **Settings** modal and the advanced Telegram panel. It includes:

- Channel name, chat ID, optional topic/thread ID, and cooldown.
- Rule toggles for AC failure/recovery, battery discharge, low SOC, low backup time, and stale data.
- SOC and backup-time thresholds.
- A message preview generated from the current active dashboard alarm.
- Backend status discovery for server-side Telegram configuration.
- A **Test Telegram** button that calls `POST /api/alerts/telegram/test`.

Telegram bot tokens must not be stored in browser localStorage. The test endpoint can use `TELEGRAM_BOT_TOKEN` from the server environment, or a one-time token entered in the UI for a test send only.

## Target Menu Structure

Use the current **Telegram** button as the entry point, then expand it into full server-backed tabs.

Recommended tabs:

- **Channels**: Telegram bot token, default chat ID/group ID, test message button.
- **Rules**: Enable/disable alert conditions and thresholds.
- **Recipients**: Route specific POPs or severities to specific Telegram chats.
- **History**: Last sent alerts, delivery status, and suppression reason.

## Core Alert Rules

Initial rules worth implementing:

- **AC input failure**: send when a POP changes from grid normal to AC failure.
- **AC restored**: send when a failed POP returns to grid normal.
- **Battery discharge**: send when battery current is negative beyond a small threshold.
- **Low SOC**: warning below 50%, critical below 30%.
- **Low backup time**: warning below 4h, critical below 2h.
- **No recent data**: warning after 3 minutes stale, critical after 10 minutes.
- **High DC load**: optional per-site threshold.

## Anti-Spam Behavior

Use alert state tracking:

- Send only on state transition, not every poll.
- Repeat unresolved critical alerts every configurable interval, for example 30 minutes.
- Send recovery notification once when the condition clears.
- Add per-rule cooldown and per-site mute/maintenance mode.

## Suggested Database Tables

```sql
CREATE TABLE alert_channels (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'telegram',
  telegram_chat_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE alert_rules (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  severity TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  threshold_json JSONB,
  cooldown_minutes INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE alert_events (
  id SERIAL PRIMARY KEY,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  state TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  UNIQUE (site_id, rule_code, state)
);
```

## Runtime Flow

1. Agent ingests metrics as usual.
2. Server updates `latest_metrics`.
3. Alert evaluator reads the same Hermes/site snapshot data.
4. Evaluator compares current state to `alert_events`.
5. New or repeated critical events are sent to Telegram.
6. Recovery messages are sent when a rule resolves.

This can run inside the server process every 30-60 seconds, or as a separate worker later if alert volume grows.

## Telegram Message Format

Example failure:

```text
NEN CRITICAL - AC INPUT FAILURE
POP: KANTOR TEBING TINGGI
AC: 0V / no signal
DC Load: 2.60 kW
Battery: 81%, discharging
Backup: 8.2h
Updated: 12:11 WIB
```

Example recovery:

```text
NEN RECOVERY - GRID NORMAL
POP: KANTOR TEBING TINGGI
AC: 221V
Battery: 84%
Downtime: 37m
```

## Implementation Order

1. Add DB tables for persistent channels/rules.
2. Add `/api/alerts/rules` and `/api/alerts/channels`.
3. Add evaluator using `latest_metrics` / Hermes snapshot logic.
4. Add automatic Telegram sends with cooldown and recovery tracking.
5. Add history UI and maintenance mute.
