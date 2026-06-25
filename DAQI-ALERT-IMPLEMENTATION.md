# DAQI Alert Implementation

End-to-end implementation detail for the DAQI alert flow — both the `GET /daqi-alert` endpoint and the 15-minute scheduler that dispatches DAQI breach notifications to subscribed users.

## Overview

DAQI ("Daily Air Quality Index") alerts are issued when Ricardo's DAQI feed reports a monitoring station with a DAQI value at or above a configured threshold (default `7`, "High"). Two flows consume this feed:

1. **`GET /daqi-alert`** — read-only API used by the front-end to surface current-day breaches for a given location.
2. **DAQI alert scheduler** — a 15-minute cron job that fetches the same feed and dispatches SMS/email notifications to users subscribed to affected regions.

Both flows fetch from the same Ricardo DAQI endpoint, apply the same threshold/validation filters, and resolve region from `siteId` via the in-memory site cache (never from Ricardo's coarse `region` field). The scheduler additionally maintains audit + dedup state in MongoDB so repeat cron ticks don't re-notify users for the same breach.

## Architecture

```
                       Ricardo DAQI feed
                              ▲
                              │  GET /api/daqi_alerts?start-date&end-date
                              │
┌─────────────────────────────┼─────────────────────────────────────┐
│                             │                                     │
│   GET /daqi-alert           │   daqi-alert-scheduler (every 15m)  │
│      ↓                      │      ↓                              │
│   daqiAlertController       │   processDaqiAlerts(db)             │
│      ↓                      │      ↓                              │
│   regionResolver            │   filterValidDaqiAlerts             │
│      ↓                      │      ↓                              │
│   fetchDaqiAlerts───────────┘   dedup vs daqi-alert-processing-state
│      ↓                          ↓
│   filter by region + 24h        per-alert: insert audit, send Notify, mark processed
│      ↓                          ↓
│   sortByDateDesc → response     daqi-alerts-audit + daqi-alert-processing-state
└─────────────────────────────────────────────────────────────────────┘
```

## New Files

### 1. `src/users/utils/daqiAlertProcessor.js`

Core scheduler business logic. Exported functions:

| Function                                    | Description                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `processDaqiAlerts(db)`                     | **Main entry point** — orchestrates the full DAQI cycle (called by the scheduler)                                                                                      |
| `filterValidDaqiAlerts(members, threshold)` | Keeps only members where `daqi >= threshold`, `validationStatus===2`, plus required `samplingPointId/siteId/date`. Maps to alert-detail shape with computed `alert-id` |
| `getMatchingUsers(users, region)`           | Expands users to one entry per matching user-location pair                                                                                                             |
| `getAlreadyProcessedAlertKeys(db)`          | Returns `Set<"samplingPointId-siteId-date">` of alerts with status `in-progress` or `processed`                                                                        |
| `markAlertInProgress(db, alertDetail)`      | Upserts into `daqi-alert-processing-state` with `process-status: "in-progress"`                                                                                        |
| `markAlertProcessed(db, alertDetail)`       | Updates the same record to `process-status: "processed"` once all notifications succeed                                                                                |
| `sendAlertToUser(userMatch, alertDetail)`   | Builds and dispatches the Notify payload; returns `notificationId`                                                                                                     |
| `buildAlertKey(member)`                     | Builds dedup key `${samplingPointId}-${siteId}-${date}`                                                                                                                |
| `getDaqiAlertWindow()`                      | Returns `{ startDate, endDate }` in UK-local `YYYY-MM-DD` — yesterday + today                                                                                          |

**Alert identity / dedup key**

```
alert-id = `${samplingPointId}-${siteId}-${date}`
```

The same `(samplingPointId, siteId, date)` row can repeat in a single Ricardo response — both the in-cycle dedup loop and the MongoDB unique index on `daqi-alert-processing-state` enforce single-processing.

**Cycle-level guards** (in execution order):

1. Empty Ricardo response → log and exit
2. Zero alerts pass `filterValidDaqiAlerts` → exit
3. After deduping vs `daqi-alert-processing-state`, zero new alerts → exit
4. After collapsing duplicate rows within this Ricardo response, zero unique alerts → exit
5. Site cache is empty AND on-demand `ensureSiteCachePopulated()` fails → skip cycle (don't mask the upstream outage as "no alerts")
6. Per-alert: siteId not in site cache → skip that alert with a warning (leave unprocessed so next cycle can retry)

### 2. `src/users/controllers/daqiAlertController.js`

Handler for `GET /daqi-alert`. Resolves region from coordinates, fetches Ricardo, filters by region + 24h window + threshold, returns sorted alert array.

**Notable patterns:**

- Uses `resolveRegionContext` from `regionResolver.js` to share region-resolution + cache-health logic with future endpoints.
- Uses `mapUpstreamError` from `upstreamErrorMapper.js` to forward Ricardo's HTTP status (4xx → 4xx, 5xx → 5xx, network/timeout → 502), with `upstreamStatus` attached to the response body so the front-end can distinguish a real upstream rejection from a transient gateway failure.
- Sorts the response by `date` descending so the front-end can rely on "latest first" regardless of Ricardo's sort behaviour.

### 3. `src/plugins/daqi-alert-scheduler.js`

Hapi plugin that owns the polling timer.

- Registers on **`server.start`** event
- **Runs `processDaqiAlerts` immediately on startup** — covers restarts between cron ticks (idempotent thanks to `daqi-alert-processing-state` dedup)
- Schedules via `node-cron` with `ricardoApi.daqiCronSchedule` (default: `*/15 * * * *` — every 15 minutes)
- Each cycle wraps the run in `withLock(server.locker, 'daqi-alert-processing', ...)` so concurrent instances don't double-fire
- Stops the cron job cleanly via `server.ext('onPostStop')`

### 4. `src/users/utils/regionResolver.js`

Shared helper for any endpoint that needs to resolve a UK region from coordinates and verify the site cache is healthy enough for downstream `getRegionForSite(siteId)` lookups.

**`resolveRegionContext(lat, long, { logPrefix, requestId })`** returns:

- `{ region }` when coordinates resolve to a known region and the site cache is populated
- `null` when:
  - coordinates fall outside known UK regions (`findRegion` returned `'Unknown'`), OR
  - site cache is empty and on-demand `ensureSiteCachePopulated()` failed

Returning `null` deliberately signals the caller to respond with an empty array — masking an empty cache as "no alerts" would hide an outage.

### 5. `src/users/utils/upstreamErrorMapper.js`

Single function `mapUpstreamError(err, serviceName)` that converts a thrown upstream error into a Boom HTTP response.

| Upstream `err.status`         | Returned status | Returned message                          |
| ----------------------------- | --------------- | ----------------------------------------- |
| 4xx                           | same 4xx        | `"<serviceName> rejected the request"`    |
| 5xx                           | same 5xx        | `"<serviceName> upstream error"`          |
| `undefined` (network/timeout) | 502             | `"<serviceName> temporarily unavailable"` |

In every case the response body carries an additional `upstreamStatus` field (the upstream HTTP status, or `null` for network failures) so consumers can distinguish causes without needing log access.

## Modified Files

### `src/config.js` — three new config blocks

```javascript
ricardoApi: {
  daqiAlertsUrl:    { default: 'https://api-ukair.defra.gov.uk/api/daqi_alerts', env: 'RICARDO_API_DAQI_ALERTS_URL' },
  daqiCronSchedule: { default: '*/15 * * * *',                                          env: 'DAQI_ALERT_CRON_SCHEDULE' },
  // ...other existing entries
},
daqiAlertTemplates: {
  smsAlert:     { env: 'SMS_DAQI_ALERT_TEMPLATE_ID' },
  smsAlertCy:   { env: 'SMS_DAQI_ALERT_CY_TEMPLATE_ID' },
  emailAlert:   { env: 'EMAIL_DAQI_ALERT_TEMPLATE_ID' },
  emailAlertCy: { env: 'EMAIL_DAQI_ALERT_CY_TEMPLATE_ID' }
}
```

The DAQI threshold reuses `metOfficeForecast.daqiAlertThreshold` (default `7`) since "what counts as high" is shared with the forecast flow.

### `src/server.js`

Registers `daqiAlertScheduler` alongside the existing schedulers.

### `src/users/utils/ricardoApiClient.js`

Adds `fetchDaqiAlerts({ startDate, endDate })` — same shape as `fetchAlerts`, but `GET`s `ricardoApi.daqiAlertsUrl`. Identical mock-mode and structured-error semantics (sets `err.status` and `err.body` on non-2xx).

### `src/users/utils/ricardoSiteAndRegionCache.js`

Adds two exports consumed by the DAQI flow:

| Export                       | Purpose                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `getSiteCacheSize()`         | Returns the current entry count — used to detect "cache is globally empty" before each cycle |
| `ensureSiteCachePopulated()` | On-demand refresh attempt that resolves to `true` if the cache is non-empty after running    |

### `src/common/helpers/mongodb.js`

Adds two new indexes (see "MongoDB Collections" below).

### `src/users/routes/daqi-alert.js`

Wires `daqiAlertHandler` to `GET /daqi-alert` with a Hapi custom validator that coerces `lat`/`long` to numbers and returns 400 on missing or non-numeric values.

## Region Resolution — Source of Truth

**Region for any alert must always be resolved from `siteId` via the GeoJSON-backed site cache (`getRegionForSite` in `ricardoSiteAndRegionCache.js`). Ricardo's own `region` field on alert objects must be ignored entirely — even as a fallback.**

**Why:**

Ricardo only returns coarse region divisions and **does not sub-divide Scotland or Wales**. The system standardises on the ~18 finer GeoJSON regions used everywhere:

- Scotland is split into multiple regions (e.g. North Eastern Scotland, Southern Scotland, East Central Scotland, Highlands and Islands, West Central Scotland)
- Wales is split similarly
- `USERS.locations.region` values are stored using these finer names
- The `siteId → region` cache is populated using the same GeoJSON via `findRegion(lat, long)`

A coarse `"Scotland"` value from Ricardo can never match a user stored under `"East Central Scotland"`, so trusting it produces silent mismatches.

**How the DAQI flow applies the rule:**

- `filterValidDaqiAlerts` deliberately does **not** carry Ricardo's `region` field into the alert detail object — only `samplingPointId`, `siteId`, `date`, `daqi`, `level`, `pollutant` survive into downstream processing.
- `processAlertForUsers` calls `getRegionForSite(alertDetail.siteId)` and **skips the alert with a warning** if the cache returns `null`. The alert is left unprocessed so a later cycle can retry once the site appears in the cache.
- The `/daqi-alert` endpoint applies the rule via `getRegionForSite(alert.siteId) === region` in its filter — alerts whose siteId isn't in the cache are excluded from the response.
- The `daqi-alert-processing-state` and `daqi-alerts-audit` documents only ever store the siteId-derived region, never Ricardo's.

The same rule is enforced in the pollutant alert flow (`pollutantAlertProcessor.js`) and the AQSR endpoint (`aqsrAlertController.js`).

---

## Step-by-Step Processing Flow

### Scheduler — `processDaqiAlerts(db)`

```
1. getDaqiAlertWindow()              — yesterday + today (UK local YYYY-MM-DD)
2. fetchDaqiAlerts({ startDate, endDate })
   ├─ on throw → log with upstreamStatus, return (next cron tick retries)
   └─ on empty member array → log "No alert members", return
3. filterValidDaqiAlerts(members, threshold)
   └─ keep only: daqi >= threshold && validationStatus===2 && samplingPointId/siteId/date present
4. getAlreadyProcessedAlertKeys(db)  — Set of (samplingPointId-siteId-date) keys with in-progress/processed status
5. Drop already-processed; collapse duplicate rows within this Ricardo response
6. Cache health gate:
   └─ if getSiteCacheSize() === 0: ensureSiteCachePopulated()
      └─ if still empty: log and skip cycle entirely
7. For each unique new alert:
   a. getRegionForSite(siteId)       — O(1) site cache lookup
      └─ if not in cache: warn, skip alert (try again next cycle)
   b. markAlertInProgress(db)        — upsert into daqi-alert-processing-state
   c. Query USERS where locations.region == resolvedRegion
   d. getMatchingUsers()             — expand to one entry per user-location pair
   e. For each user-location pair:
      - insertDaqiAuditEntry()       — daqi-alerts-audit row, status not-processed
      - sendAlertToUser()            — Notify API call
      - updateDaqiAuditEntry()       — status processed + notificationId
   f. If all notifications succeeded → markAlertProcessed()
```

### Endpoint — `GET /daqi-alert?lat=…&long=…`

```
1. Validate lat/long via the route's custom validator (Boom 400 on invalid)
2. resolveRegionContext(lat, long)
   ├─ region === 'Unknown'           → respond []
   └─ site cache empty + refresh failed → respond [] (cache outage)
3. Build yesterday/today UK-local date window
4. fetchDaqiAlerts({ startDate, endDate })
   └─ on throw → mapUpstreamError(err, 'DAQI alert service')
      • upstream 4xx → return same 4xx with upstreamStatus
      • upstream 5xx → return same 5xx with upstreamStatus
      • network/timeout → return 502 with upstreamStatus:null
5. Filter members:
   • typeof alert.daqi === 'number'
   • alert.daqi >= daqiThreshold
   • alert.validationStatus === 2
   • isWithinLast24Hours(alert.date)         — precise millisecond check
   • getRegionForSite(alert.siteId) === region
6. sortByDateDesc(matchingAlerts).map(buildDaqiEntry) → respond 200
```

## MongoDB Collections

### `daqi-alert-processing-state` (new)

Tracks which DAQI breaches have been seen/processed across cron cycles so a repeating breach doesn't get re-notified every 15 minutes.

```json
{
  "_id": "ObjectId",
  "alert-id": "12340-UKA00212-2026-05-20T03:00:00+01:00",
  "samplingPointId": 12340,
  "siteId": "UKA00212",
  "date": "2026-05-20T03:00:00+01:00",
  "daqi": 7,
  "region": "Northern Ireland",
  "pollutant": "NO<sub>2</sub> (NO2)",
  "process-status": "processed",
  "alert-started-timestamp": "2026-05-20T03:05:00.000Z",
  "processedAt": "2026-05-20T03:05:01.842Z"
}
```

`alert-id` is the same composite key (`${samplingPointId}-${siteId}-${date}`) used by `daqi-alerts-audit`, so a row in either collection can be joined to the matching row in the other by a single field. The unique index is still on `{ samplingPointId, siteId, date }` since `alert-id` is purely a derived/denormalised view of those three.

**Indexes:**

- Unique compound on `{ samplingPointId, siteId, date }` — enforces single-processing of a breach within and across cycles

### `daqi-alerts-audit` (new)

One row per user-location notification attempt.

```json
{
  "_id": "ObjectId",
  "alert-id": "12340-UKA00212-2026-05-20T03:00:00+01:00",
  "samplingPointId": 12340,
  "siteId": "UKA00212",
  "date": "2026-05-20T03:00:00+01:00",
  "daqi": 7,
  "region": "Northern Ireland",
  "pollutant": "NO2 (NO2)",
  "user_contact": "user@example.com",
  "alertType": "email",
  "lang": "en",
  "location": "Belfast, City of Belfast",
  "daqi-alert-status": "processed",
  "notificationId": "5b3a7e2c-...",
  "timestamp": "2026-05-20T03:05:01.000Z"
}
```

**Indexes:**

- `{ "alert-id": 1 }`
- Unique compound on `{ "alert-id", user_contact, location }` — one notification per user-location per alert

### `USERS` (existing — read-only by this feature)

Used unchanged. The DAQI flow queries `locations.region` to find affected users.

## Notification Payload

Sent to `aqie-notify-service` `POST /send-notification`.

`templateId` is resolved based on `alertType` and `lang`:

| alertType | lang | Config key                        | Env variable                      |
| --------- | ---- | --------------------------------- | --------------------------------- |
| `sms`     | `en` | `daqiAlertTemplates.smsAlert`     | `SMS_DAQI_ALERT_TEMPLATE_ID`      |
| `sms`     | `cy` | `daqiAlertTemplates.smsAlertCy`   | `SMS_DAQI_ALERT_CY_TEMPLATE_ID`   |
| `email`   | `en` | `daqiAlertTemplates.emailAlert`   | `EMAIL_DAQI_ALERT_TEMPLATE_ID`    |
| `email`   | `cy` | `daqiAlertTemplates.emailAlertCy` | `EMAIL_DAQI_ALERT_CY_TEMPLATE_ID` |

**SMS:**

```json
{
  "phoneNumber": "+447123456789",
  "templateId": "<SMS_DAQI_ALERT_TEMPLATE_ID>",
  "alertId": "12340-UKA00212-2026-05-20T03:00:00+01:00",
  "personalisation": {
    "location": "Belfast",
    "daqi": "7",
    "Pollutant": "nitrogen dioxide (NO2)",
    "checkAirQualityLink": "https://check-air-quality.service.gov.uk/location/belfast?lang=en"
  }
}
```

**Email:**

```json
{
  "emailAddress": "user@example.com",
  "templateId": "<EMAIL_DAQI_ALERT_TEMPLATE_ID>",
  "alertId": "12340-UKA00212-2026-05-20T03:00:00+01:00",
  "personalisation": {
    "location": "Belfast",
    "daqi": "7",
    "Pollutant": "nitrogen dioxide (NO2)",
    "checkAirQualityLink": "https://check-air-quality.service.gov.uk/location/belfast?lang=en",
    "unsubscribeLink": "https://.../unsubscribe-email-link?email=user%40example.com"
  }
}
```

### `checkAirQualityLink` slug rules

URL path is built by `formatLocationForUrl(location)` from `src/users/utils/locationUtils.js` (shared with pollutant and forecast schedulers). See [POLLUTANT-ALERT-IMPLEMENTATION.md](./POLLUTANT-ALERT-IMPLEMENTATION.md) for the full slug-rules table — postcode-prefixed locations (e.g. `"N8 7GE, Hornsey"`) become `n87ge`; non-postcode locations slug both parts.

## Endpoint Response Shape — `GET /daqi-alert`

**Success (200):**

```json
[
  {
    "active-breaches": true,
    "pollutant-name": "nitrogen dioxide (NO2)",
    "daqi": 7,
    "samplingPointId": 12340,
    "siteId": "UKA00212",
    "alert-started": "2026-05-20T03:00:00+01:00"
  }
]
```

Returns `[]` (still 200) when the resolved region has no current matching alerts, when the coordinates fall outside known UK regions, or when the site cache is empty after a failed refresh.

**Error responses** carry an `upstreamStatus` field:

```json
{
  "statusCode": 503,
  "error": "Service Unavailable",
  "message": "DAQI alert service upstream error",
  "upstreamStatus": 503
}
```

- 4xx from Ricardo → same 4xx (with `upstreamStatus` set)
- 5xx from Ricardo → same 5xx (with `upstreamStatus` set)
- Network failure / timeout / DNS → 502 with `upstreamStatus: null`

## Multi-Location Behaviour

A user subscribed to multiple locations in the **same region** receives **one alert per location** — by design:

```
User: +447459418445
Locations: Belfast (Northern Ireland), Derry (Northern Ireland)
Alert Region: Northern Ireland
→ Sends 2 SMS — one for Belfast, one for Derry
→ 2 audit entries in daqi-alerts-audit
```

## Log Prefixes

All log statements in `daqiAlertProcessor.js` are prefixed with `[DAQI]` to distinguish them from pollutant/forecast logs when schedulers run concurrently. The endpoint handler uses `[DAQIAlert]`.

## Environment Variables

| Variable                          | Default                                          | Required        |
| --------------------------------- | ------------------------------------------------ | --------------- |
| `RICARDO_API_DAQI_ALERTS_URL`     | `https://api-ukair.defra.gov.uk/api/daqi_alerts` | No              |
| `DAQI_ALERT_CRON_SCHEDULE`        | `*/15 * * * *`                                   | No              |
| `SMS_DAQI_ALERT_TEMPLATE_ID`      | _(empty)_                                        | **Yes** in prod |
| `SMS_DAQI_ALERT_CY_TEMPLATE_ID`   | _(empty)_                                        | **Yes** in prod |
| `EMAIL_DAQI_ALERT_TEMPLATE_ID`    | _(empty)_                                        | **Yes** in prod |
| `EMAIL_DAQI_ALERT_CY_TEMPLATE_ID` | _(empty)_                                        | **Yes** in prod |
| `DAQI_ALERT_THRESHOLD` (shared)   | `7` (via `metOfficeForecast.daqiAlertThreshold`) | No              |

Plus all the inherited `RICARDO_API_*`, `NOTIFICATION_SERVICE_URL`, and `CHECK_AIR_QUALITY_LINK` env vars documented in [POLLUTANT-ALERT-IMPLEMENTATION.md](./POLLUTANT-ALERT-IMPLEMENTATION.md).

## Error Handling Summary

| Failure point                                  | Behaviour                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Ricardo DAQI fetch throws (scheduler)          | Logs with structured `upstreamStatus` (HTTP status, or `null` for network/timeout). Cycle aborts; next cron tick (15 min) retries.  |
| Ricardo DAQI fetch throws (`/daqi-alert`)      | `mapUpstreamError` returns the upstream status (4xx→4xx, 5xx→5xx, network→502) with `upstreamStatus` in the response body.          |
| No member array / empty list                   | Logs info, exits cleanly                                                                                                            |
| Site cache empty + refresh fails (scheduler)   | Logs "site cache empty…skipping cycle", exits. Avoids masking an outage as "no alerts".                                             |
| Site cache empty + refresh fails (endpoint)    | Responds with `[]`. `regionResolver` returns `null` to signal the caller.                                                           |
| siteId not in cache (per-alert)                | Warning log, alert is skipped this cycle, **left in `not-processed` state** so a later cycle can retry once the cache catches up    |
| Individual notification fails                  | Logs error, audit entry stays `not-processed`, `allSent` flips to false — `daqi-alert-processing-state` is **not** marked processed |
| Duplicate audit insert (`DB_ERROR_CODE` 11000) | Logs warning, skips insert, continues                                                                                               |
| Service restarts between ticks                 | Immediate startup run catches any unprocessed alerts; `daqi-alert-processing-state` prevents re-processing already-sent ones        |

Failed `not-processed` entries in `daqi-alerts-audit` are the evidence trail for manual investigation. No automatic retry is performed beyond the next scheduled cron tick.

## Sequence Diagram (scheduler cycle)

```
Cron tick (every 15m)
   │
   ▼
processDaqiAlerts(db) ────────► getDaqiAlertWindow()    [UK-local yesterday/today]
   │                                       │
   ▼                                       ▼
Ricardo /api/daqi_alerts ────► response { member: [...] }
   │
   ▼
filterValidDaqiAlerts ────────► [valid alerts: daqi≥threshold, validated]
   │
   ▼
daqi-alert-processing-state ──► [already-processed keys]
   │
   ▼
[dedup + collapse duplicate rows]
   │
   ▼
getSiteCacheSize() === 0?
   │      yes → ensureSiteCachePopulated() → still 0? → exit
   │
   ▼
for each unique alert:
   │
   ├─► getRegionForSite(siteId)
   │      └─ not in cache? warn + skip alert (retry next cycle)
   │
   ├─► markAlertInProgress(db, alertDetail)
   │
   ├─► USERS.find({ 'locations.region': region })
   │
   ├─► for each user-location pair:
   │      ├─► insertDaqiAuditEntry → daqi-alerts-audit (status: not-processed)
   │      ├─► sendAlertToUser → Notify API
   │      └─► updateDaqiAuditEntry → status: processed, notificationId
   │
   └─► if all sent successfully → markAlertProcessed(db, alertDetail)
```
