# Pollutant Measurement Alerts — Implementation Documentation

## Overview

This feature adds automated pollutant alert notifications to `aqie-alert-back-end-service`. Every 30 minutes the service polls the Ricardo AQSR Alerts API, identifies new high-level alerts, matches them to registered users by region, and dispatches SMS/email notifications via `aqie-notify-service`. Every notification attempt is recorded in the `pollutant-alerts-audit` collection for traceability.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Hapi Server (server.js)                          │
│                                                                      │
│  pollutant-alert-scheduler (plugin)                                  │
│    │  fires on server 'start'                                        │
│    │  runs immediately + node-cron '*/30 * * * *'                    │
│    ▼                                                                 │
│  processPollutantAlerts(db)   ◄── pollutantAlertProcessor.js         │
│    │                                                                 │
│    ├── ricardoApiClient.js ──► POST /api/login_check (token)         │
│    │                          GET  /api/aqsr_alerts (alerts)         │
│    │                                                                 │
│    ├── MongoDB: pollutant-alert-processing-state         (skip / mark in-progress)      │
│    ├── MongoDB: USERS                 (find by region)               │
│    ├── MongoDB: pollutant-alerts-audit (insert not-processed)        │
│    │                                                                 │
│    ├── notifyServiceClient.js ──► POST /send-notification            │
│    │                                                                 │
│    ├── MongoDB: pollutant-alerts-audit (update processed)            │
│    └── MongoDB: pollutant-alert-processing-state         (mark processed)               │
└──────────────────────────────────────────────────────────────────────┘
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
- Supports mock mode via `RICARDO_API_USE_MOCK=true` for local testing

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
| `markAlertInProgress(db, alertDetail)`    | Upserts alert into `pollutant-alert-processing-state` with `status: "in-progress"`              |
| `markAlertProcessed(db, alertId)`         | Updates `pollutant-alert-processing-state` record to `status: "processed"`                      |
| `sendAlertToUser(userMatch, alertDetail)` | Builds and dispatches the notification payload; returns `notificationId`                        |

**`processPollutantAlerts` step-by-step:**

```
1. fetchAlerts()                     — get fresh token, fetch Ricardo API
2. filterValidAlerts()               — keep only alertLevel=true && validationStatus==2
3. getAlreadyProcessedAlertIds()     — load IDs from pollutant-alert-processing-state collection
4. Exclude already-seen IDs          — deduplicate across cron cycles
5. For each new alert:
   a. markAlertInProgress()          — upsert into pollutant-alert-processing-state
   b. Query USERS where locations.region == alertRegion
   c. getMatchingUsers()             — expand to one entry per matching location
   d. For each user-location pair:
      - insertPollutantAuditEntry()  — write audit record (not-processed)
      - sendAlertToUser()            — build payload, call notifyServiceClient
      - updatePollutantAuditEntry()  — mark audit record processed + notificationId
   e. If ALL notifications succeeded → markAlertProcessed()
```

---

### 3. `src/plugins/pollutant-alert-scheduler.js`

A Hapi plugin that owns the polling timer, using `node-cron` for scheduling.

- Registers on **`server.start`** event
- **Runs `processPollutantAlerts` immediately on startup** — ensures no alerts are missed if the service restarts between cron ticks. Already-processed alerts are safely skipped via the `pollutant-alert-processing-state` collection check (`in-progress` / `processed`)
- Schedules subsequent runs via `node-cron` using the cron expression from config (default: `*/30 * * * *` — every 30 minutes, clock-aligned at :00 and :30 of every hour)
- Stops the cron job cleanly via `server.ext('onPostStop')` on server shutdown

---

## Modified Files

### `src/config.js` — two new config blocks

```
ricardoApi
  ├── loginUrl      env: RICARDO_API_LOGIN_URL
  ├── alertsUrl     env: RICARDO_API_ALERTS_URL
  ├── email         env: RICARDO_API_EMAIL
  ├── password      env: RICARDO_API_PASSWORD       (sensitive)
  ├── cronSchedule  env: POLLUTANT_CRON_SCHEDULE     (default: '*/30 * * * *')
  └── useMock       env: RICARDO_API_USE_MOCK        (default: true)

alertTemplates
  ├── smsAlert          env: SMS_ALERT_TEMPLATE_ID
  ├── smsAlertCy        env: SMS_ALERT_CY_TEMPLATE_ID
  ├── emailAlert        env: EMAIL_ALERT_TEMPLATE_ID
  ├── emailAlertCy      env: EMAIL_ALERT_CY_TEMPLATE_ID
  └── checkAirQualityLink  env: CHECK_AIR_QUALITY_LINK
```

### `src/common/helpers/mongodb.js`

Indexes created at startup:

```js
// pollutant-alert-processing-state — prevents duplicate alert processing
db.collection('pollutant-alert-processing-state').createIndex(
  { 'alert-id': 1 },
  { unique: true }
)

// pollutant-alerts-audit — fast queries by alert ID
db.collection('pollutant-alerts-audit').createIndex({ 'alert-id': 1 })

// pollutant-alerts-audit — prevents duplicate audit entries per user-location per alert
db.collection('pollutant-alerts-audit').createIndex(
  { 'alert-id': 1, user_contact: 1, location: 1 },
  { unique: true }
)
```

### `src/server.js`

Imported and registered `pollutantAlertScheduler` and `forecastAlertScheduler` as Hapi plugins.

---

## MongoDB Collections

### `USERS` (existing — read-only by this feature)

```json
{
  "user_contact": "+447469296586",
  "alertType": "sms",
  "lang": "en",
  "locations": [{ "location": "Staines", "region": "England" }]
}
```

### `pollutant-alert-processing-state` (new)

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
   "in-progress"   ← upserted before notifications are sent
        │           (prevents duplicate processing if service restarts mid-cycle)
        ▼
   "processed"     ← set after all notifications send successfully
        │
        └─ future cron cycles skip this alert-id entirely
```

### `pollutant-alerts-audit` (new)

One document per user-location pair per alert. Provides a permanent audit trail of every notification attempt.

| Field                    | Type           | Description                                              |
| ------------------------ | -------------- | -------------------------------------------------------- |
| `alert-id`               | Number         | `samplingPointId` from Ricardo API                       |
| `region`                 | String         | Alert region                                             |
| `pollutant`              | String         | Cleaned pollutant name (HTML stripped)                   |
| `user_contact`           | String         | Email address or phone number                            |
| `alertType`              | String         | `"email"` or `"sms"`                                     |
| `lang`                   | String         | `"en"` or `"cy"` — determines which template was used    |
| `location`               | String         | The specific registered location name                    |
| `pollutant-alert-status` | String         | `"not-processed"` → `"processed"`                        |
| `notificationId`         | String \| null | UUID returned by `aqie-notify-service`; `null` if failed |
| `timestamp`              | Date           | When the audit entry was created                         |

**Indexes:**

- `{ 'alert-id': 1 }` — fast queries by alert
- `{ 'alert-id', user_contact, location }` unique — prevents duplicate entries

**Status lifecycle:**

```
insertPollutantAuditEntry()
        │
        ▼
  "not-processed"   ← written before notification attempt
        │
        ▼
  "processed"       ← written after aqie-notify-service returns successfully
        │
        └─ notificationId populated with the UUID from notify service

  [if notification fails]
  "not-processed" remains — visible in collection for manual investigation
```

**Example document (after successful notification):**

```json
{
  "alert-id": 12345,
  "region": "England",
  "pollutant": "O3 (O3)",
  "user_contact": "alice@example.com",
  "alertType": "email",
  "lang": "en",
  "location": "Staines",
  "pollutant-alert-status": "processed",
  "notificationId": "a1b2c3d4-1111-2222-3333-aaaaaaaaaaaa",
  "timestamp": "2026-04-03T09:30:00.000Z"
}
```

---

## Notification Payload

Sent to `aqie-notify-service` `POST /send-notification`.

The `templateId` is resolved based on `alertType` and `lang` from the USERS document:

| alertType | lang | Config key                    | Env variable                 |
| --------- | ---- | ----------------------------- | ---------------------------- |
| `sms`     | `en` | `alertTemplates.smsAlert`     | `SMS_ALERT_TEMPLATE_ID`      |
| `sms`     | `cy` | `alertTemplates.smsAlertCy`   | `SMS_ALERT_CY_TEMPLATE_ID`   |
| `email`   | `en` | `alertTemplates.emailAlert`   | `EMAIL_ALERT_TEMPLATE_ID`    |
| `email`   | `cy` | `alertTemplates.emailAlertCy` | `EMAIL_ALERT_CY_TEMPLATE_ID` |

**SMS:**

```json
{
  "phoneNumber": "+447123456789",
  "templateId": "<SMS_ALERT_TEMPLATE_ID>",
  "personalisation": {
    "location": "Staines",
    "concentration": "168",
    "Pollutant": "O3 (O3)",
    "checkAirQualityLink": "https://check-air-quality.service.gov.uk/location/staines?lang=en"
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
    "Pollutant": "O3 (O3)",
    "checkAirQualityLink": "https://check-air-quality.service.gov.uk/location/staines?lang=en",
    "unsubscribeLink": "https://.../unsubscribe-email-link?email=user%40example.com"
  }
}
```

---

## Multi-Location Behaviour

A user with multiple locations registered in the **same region** receives **one alert per location** — by design:

```
User: +447459418445
Locations: Bristol (England), Gloucester (England)
Alert Region: England
→ Sends 2 SMS — one for Bristol, one for Gloucester
→ 2 audit entries in pollutant-alerts-audit
```

---

## Log Prefixes

All log statements in `pollutantAlertProcessor.js` are prefixed with `[Pollutant]` to distinguish them from forecast alert logs when both schedulers run concurrently.

---

## Environment Variables

| Variable                     | Default                                                 | Required |
| ---------------------------- | ------------------------------------------------------- | -------- |
| `RICARDO_API_EMAIL`          | _(set in config)_                                       | Yes      |
| `RICARDO_API_PASSWORD`       | _(set in config)_                                       | Yes      |
| `RICARDO_API_LOGIN_URL`      | `https://uk-air-api.staging.rcdo.co.uk/api/login_check` | No       |
| `RICARDO_API_ALERTS_URL`     | `https://uk-air-api.staging.rcdo.co.uk/api/aqsr_alerts` | No       |
| `POLLUTANT_CRON_SCHEDULE`    | `*/30 * * * *`                                          | No       |
| `RICARDO_API_USE_MOCK`       | `true`                                                  | No       |
| `SMS_ALERT_TEMPLATE_ID`      | _(set in config)_                                       | Yes      |
| `SMS_ALERT_CY_TEMPLATE_ID`   | _(set in config)_                                       | Yes      |
| `EMAIL_ALERT_TEMPLATE_ID`    | _(set in config)_                                       | Yes      |
| `EMAIL_ALERT_CY_TEMPLATE_ID` | _(set in config)_                                       | Yes      |
| `CHECK_AIR_QUALITY_LINK`     | `https://check-air-quality.service.gov.uk/location/`    | No       |

---

## Sequence Diagram

```
Scheduler       RicardoApiClient     MongoDB                   NotifyService
    │                  │                │                           │
    │ on server start  │                │                           │
    │ (or */30 cron)   │                │                           │
    │── processPollutantAlerts()        │                           │
    │                  │                │                           │
    │          POST /api/login_check    │                           │
    │◄── token ────────│                │                           │
    │                  │                │                           │
    │          GET /api/aqsr_alerts     │                           │
    │◄── alert data ───│                │                           │
    │                  │                │                           │
    │── filterValidAlerts()             │                           │
    │── query pollutant-alert-processing-state (skip) ────►│                           │
    │◄─────────────────────────────────│                           │
    │                  │                │                           │
    │  [for each new alert]             │                           │
    │── upsert pollutant-alert-processing-state (in-progress) ────────────────────────►│
    │── query USERS by region ─────────►│                           │
    │◄── matching users ────────────────│                           │
    │                  │                │                           │
    │  [for each user-location pair]    │                           │
    │── insertPollutantAuditEntry ─────►│ (not-processed)           │
    │──────────────────────────────────────── POST /send-notification ►
    │◄────────────────────────────────────────── { notificationId } │
    │── updatePollutantAuditEntry ─────►│ (processed + notifId)     │
    │                  │                │                           │
    │── upsert pollutant-alert-processing-state (processed) ──────────────────────────►│
```

---

## Error Handling Summary

| Failure point                       | Behaviour                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /aqsr_alerts` throws           | Logs error, cycle stops, next run at next cron tick                                                                               |
| No valid alerts after filter        | Logs info, cycle stops                                                                                                            |
| All alerts already processed        | Logs info, cycle stops immediately                                                                                                |
| Individual notification fails       | Logs error, audit entry stays `not-processed`, `allSent` set to false — `pollutant-alert-processing-state` not marked processed   |
| Duplicate audit insert (code 11000) | Logs warning, skips insert, continues                                                                                             |
| Service restarts between ticks      | Immediate startup run catches any unprocessed alerts; `pollutant-alert-processing-state` prevents re-processing already-sent ones |

Failed `not-processed` entries in `pollutant-alerts-audit` are the evidence trail for manual investigation. No automatic retry is performed.
