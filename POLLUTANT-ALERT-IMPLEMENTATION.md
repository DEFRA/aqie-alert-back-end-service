# Pollutant Measurement Alerts — Implementation Documentation

## Overview

This feature adds automated pollutant alert notifications to `aqie-alert-back-end-service`. Every 30 minutes the service polls the Ricardo AQSR Alerts API, identifies new high-level alerts, matches them to registered users by region, and dispatches SMS/email notifications via `aqie-notify-service`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Hapi Server (server.js)                        │
│                                                                 │
│  pollutant-alert-scheduler (plugin)                             │
│    │  fires on server 'start'                                   │
│    │  setInterval every 30 min                                  │
│    ▼                                                            │
│  processPollutantAlerts(db)   ◄── pollutantAlertProcessor.js    │
│    │                                                            │
│    ├── ricardoApiClient.js ──► POST /api/login_check (token)    │
│    │                          GET  /api/aqsr_alerts (alerts)    │
│    │                                                            │
│    ├── MongoDB: alert-details  (skip / mark in-progress)        │
│    ├── MongoDB: USERS          (find by region)                 │
│    │                                                            │
│    ├── notifyServiceClient.js ──► POST /send-notification       │
│    │                                                            │
│    └── MongoDB: alert-details  (mark processed)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## New Files

### 1. `src/users/utils/ricardoApiClient.js`

Handles all HTTP communication with the Ricardo API.

**`getAccessToken()`**

- `POST` to `RICARDO_API_LOGIN_URL` with `{ email, password }`
- Returns the JWT `token` from the response body
- Throws on non-2xx response

**`fetchAlerts()`**

- Calls `getAccessToken()` to get a fresh token on every invocation
- `GET` to `RICARDO_API_ALERTS_URL` with `Authorization: Bearer <token>`
- Returns the full response body `{ "@context", "@id", "@type", "totalItems", "member": [...] }`
- Throws on non-2xx response

---

### 2. `src/users/utils/pollutantAlertProcessor.js`

Core business logic. Exported functions:

| Function                                  | Description                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `processPollutantAlerts(db)`              | **Main entry point** — orchestrates the full cycle                                              |
| `filterValidAlerts(members)`              | Filters raw API members to `alertLevel=true && validationStatus==2`, maps to alert-detail shape |
| `getMatchingUsers(users, region)`         | Returns one entry per matching user-location pair for a given region                            |
| `cleanPollutantName(pollutant)`           | Strips HTML tags from pollutant strings e.g. `O<sub>3</sub>` → `O3`                             |
| `getAlreadyProcessedAlertIds(db)`         | Returns `Set<samplingPointId>` of alerts with status `in-progress` or `processed`               |
| `markAlertInProgress(db, alertDetail)`    | Upserts alert into `alert-details` with `status: "in-progress"`                                 |
| `markAlertProcessed(db, alertId)`         | Updates `alert-details` record to `status: "processed"`                                         |
| `sendAlertToUser(userMatch, alertDetail)` | Builds and dispatches the notification payload; returns `notificationId`                        |

**`processPollutantAlerts` step-by-step:**

```
1. fetchAlerts()                 — get fresh token, fetch Ricardo API
2. filterValidAlerts()           — keep only alertLevel=true && validationStatus==2
3. getAlreadyProcessedAlertIds() — load IDs from alert-details collection
4. Exclude already-seen IDs      — deduplicate across cron cycles
5. For each new alert:
   a. markAlertInProgress()      — upsert into alert-details
   b. Query USERS where locations.region == alertRegion
   c. getMatchingUsers()         — expand to one entry per matching location
   d. For each user-location pair:
      - build notification payload
      - sendNotification() via notifyServiceClient
   e. If ALL notifications succeeded → markAlertProcessed()
```

---

### 3. `src/plugins/pollutant-alert-scheduler.js`

A Hapi plugin that owns the polling timer.

- Registers on **`server.start`** event (after MongoDB is ready)
- Runs `processPollutantAlerts` immediately on startup, then every `RICARDO_POLLING_INTERVAL_MS` ms
- Guard flag `isRunning` prevents overlapping cycles if a cycle takes longer than the interval
- Clears the interval on **`server.stop`** for graceful shutdown

---

## Modified Files

### `src/config.js` — two new config blocks

```
ricardoApi
  ├── loginUrl          env: RICARDO_API_LOGIN_URL
  ├── alertsUrl         env: RICARDO_API_ALERTS_URL
  ├── email             env: RICARDO_API_EMAIL
  ├── password          env: RICARDO_API_PASSWORD          (sensitive)
  └── pollingIntervalMs env: RICARDO_POLLING_INTERVAL_MS   (default: 1800000)

alertTemplates
  ├── smsAlert          env: SMS_ALERT_TEMPLATE_ID
  └── emailAlert        env: EMAIL_ALERT_TEMPLATE_ID
```

### `src/common/helpers/mongodb.js`

Added a unique index on the `alert-details` collection:

```js
await db
  .collection('alert-details')
  .createIndex({ 'alert-id': 1 }, { unique: true })
```

### `src/server.js`

Registered `pollutantAlertScheduler` as a Hapi plugin after `router`.

---

## MongoDB Collections

### `USERS` (existing — read-only by this feature)

```json
{
  "user_contact": "+447469296586",
  "alertType": "sms",
  "locations": [{ "location": "Staines", "region": "England" }]
}
```

### `alert-details` (new)

| Field            | Type           | Description                                       |
| ---------------- | -------------- | ------------------------------------------------- |
| `alert-id`       | Number         | `samplingPointId` from Ricardo API — unique index |
| `region`         | String         | Alert region from Ricardo                         |
| `pollutant`      | String         | Raw pollutant string (may contain HTML)           |
| `alertText`      | String         | Alert text                                        |
| `concentration`  | Number         | Measured concentration                            |
| `alertThreshold` | Number \| null | Threshold value                                   |
| `status`         | String         | `"in-progress"` or `"processed"`                  |
| `createdAt`      | Date           | Set when first inserted                           |
| `processedAt`    | Date           | Set when marked processed                         |

**Status lifecycle:**

```
[new alert from Ricardo]
        │
        ▼
   "in-progress"   ← inserted before notifications are sent
        │           (prevents duplicate processing if service restarts mid-cycle)
        ▼
   "processed"     ← set after all notifications send successfully
        │
        └─ future cron cycles skip this alert-id entirely
```

---

## Notification Payload

Sent to `aqie-notify-service` `POST /send-notification`:

**SMS:**

```json
{
  "phoneNumber": "+447123456789",
  "templateId": "<SMS_ALERT_TEMPLATE_ID>",
  "personalisation": {
    "location": "Staines",
    "concentration": "168",
    "Pollutant": "O3 (O3)"
  }
}
```

**Email:**

```json
{
  "emailAddress": "user@example.com",
  "templateId": "<EMAIL_ALERT_TEMPLATE_ID>",
  "personalisation": {
    "location": "Staines",
    "concentration": "168",
    "Pollutant": "O3 (O3)"
  }
}
```

The `templateId` is selected based on the user's `alertType` field from the `USERS` collection.

---

## Multi-Location Behaviour

A user with multiple locations registered in the **same region** receives **one alert per location** — by design:

```
User: +447459418445
Locations: Bristol (England), Gloucester (England)
Alert Region: England
→ Sends 2 SMS — one for Bristol, one for Gloucester ✓
```

---

## Environment Variables

| Variable                      | Default                                                 | Required |
| ----------------------------- | ------------------------------------------------------- | -------- |
| `RICARDO_API_EMAIL`           | _(set in config)_                                       | Yes      |
| `RICARDO_API_PASSWORD`        | _(set in config)_                                       | Yes      |
| `RICARDO_API_LOGIN_URL`       | `https://uk-air-api.staging.rcdo.co.uk/api/login_check` | No       |
| `RICARDO_API_ALERTS_URL`      | `https://uk-air-api.staging.rcdo.co.uk/api/aqsr_alerts` | No       |
| `RICARDO_POLLING_INTERVAL_MS` | `1800000` (30 min)                                      | No       |
| `SMS_ALERT_TEMPLATE_ID`       | _(empty)_                                               | Yes      |
| `EMAIL_ALERT_TEMPLATE_ID`     | _(set in config)_                                       | Yes      |

---

## Test Coverage

| File                                              | Tests | Coverage                                                                                                   |
| ------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `src/users/utils/ricardoApiClient.test.js`        | 4     | Token success/failure, alerts fetch success/failure                                                        |
| `src/users/utils/pollutantAlertProcessor.test.js` | 14    | Filter logic, user matching, multi-location, SMS/email dispatch, failure isolation, skip-already-processed |

All 178 tests across the full suite pass.

---

## Sequence Diagram

```
Scheduler          RicardoApiClient     MongoDB             NotifyService
    │                    │                  │                    │
    │── runCycle() ──────►                  │                    │
    │                    │                  │                    │
    │               POST /login_check       │                    │
    │                    │◄─── token ───────│                    │
    │                    │                  │                    │
    │               GET /aqsr_alerts        │                    │
    │                    │◄── alert data ───│                    │
    │                    │                  │                    │
    │◄── alertData ──────│                  │                    │
    │                    │                  │                    │
    │── filterValidAlerts()                 │                    │
    │                    │                  │                    │
    │── query alert-details (skip list) ───►│                    │
    │◄──────────────────────────────────────│                    │
    │                    │                  │                    │
    │  [for each new alert]                 │                    │
    │── upsert alert-details (in-progress) ►│                    │
    │── query USERS by region ─────────────►│                    │
    │◄── matching users ────────────────────│                    │
    │                    │                  │                    │
    │  [for each user-location pair]        │                    │
    │────────────────────────────────────── POST /send-notification ►
    │◄─────────────────────────────────────────── { notificationId } │
    │                    │                  │                    │
    │── upsert alert-details (processed) ──►│                    │
    │                    │                  │                    │
```
