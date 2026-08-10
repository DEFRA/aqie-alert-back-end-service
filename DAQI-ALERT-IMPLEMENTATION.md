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

| Function                                    | Description                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `processDaqiAlerts(db)`                     | **Main entry point** — orchestrates the full DAQI cycle (called by the scheduler)                                                                                              |
| `filterValidDaqiAlerts(members, threshold)` | Keeps only members where `daqi >= threshold`, `validationStatus===2`, plus required `samplingPointId/siteId/date`. Maps to alert-detail shape with computed `alert-id`         |
| `buildLatestDaqiReadingMap(alerts)`         | Builds a `Map<samplingPointId, {date, daqi}>` of the NEWEST pre-dedup reading, so state writes reflect Ricardo's latest measurement rather than the dedup breach-start reading |
| `getMatchingUsers(users, region)`           | Expands users to one entry per matching user-location pair (re-exported from `alertCycleUtils.js`)                                                                             |
| `classifyAlert(existingRow, now)`           | Returns `'new'` / `'update-only'` / `'skip-stuck'` — the 24h sliding-window verdict anchored on `lastUpdatedFromRicardo`                                                       |
| `markAlertInProgress(db, alertDetail)`      | Upserts a NEW event row into `daqi-alert-processing-state` (compound key `{samplingPointId, alert-started-timestamp}`) with `process-status: "in-progress"`                    |
| `markAlertProcessed(db, alertDetail)`       | Updates the same event row to `process-status: "processed"` once all notifications succeed                                                                                     |
| `sendAlertToUser(userMatch, alertDetail)`   | Builds and dispatches the Notify payload; returns `notificationId`                                                                                                             |
| `buildAlertKey(member)`                     | Builds the audit-side key `${samplingPointId}-${siteId}-${date}` (see "Alert identity / dedup keys" below)                                                                     |

`updateStateForExistingAlert`, `insertDaqiAuditEntry`, `updateDaqiAuditEntry`, `enrichAlertWithLatestReading`, `getDaqiLabel`/`getDaqiLabelTitle`, and `loadRecentStateRowsBySamplingPointId` are internal (not exported) but referenced throughout this document.

**Alert identity / dedup keys**

There are two distinct keys, serving different purposes:

```
alert-id (audit correlation)   = `${samplingPointId}-${siteId}-${date}`   — buildAlertKey()
state key (event dedup)        = { samplingPointId, 'alert-started-timestamp' }
```

- **`alert-id`** identifies a _specific Ricardo reading_ and is stored on every `daqi-alerts-audit` row so it traces back to the exact payload that triggered it. It includes `date`, so two readings of the same physical breach get distinct audit identifiers.
- **The state key** identifies a _breach event_ in `daqi-alert-processing-state`. It is `{samplingPointId, 'alert-started-timestamp'}` — deliberately excluding `siteId`/`date` — so that as long as Ricardo keeps reporting this `samplingPointId` at least once every 24 hours, all those readings collapse onto the same event document — this is the 24h sliding-window rule `classifyAlert` enforces (see the Step-by-Step flow below). The unique index on this collection is `samplingPointId_alertStarted_unique`.

The same `(samplingPointId, siteId, date)` row can repeat within a single Ricardo response — `deduplicateAlertsOldestFirst` collapses these before per-alert processing runs.

**Cycle-level guards** (in execution order):

1. Empty Ricardo response → log and exit
2. Zero alerts pass `filterValidDaqiAlerts` → exit
3. Collapse duplicate rows within this Ricardo response (`deduplicateAlertsOldestFirst`) → build the unique-candidate list
4. Site cache is empty AND on-demand `ensureSiteCachePopulated()` fails → skip cycle entirely (don't mask the upstream outage as "no alerts")
5. Per-candidate: `classifyAlert` returns `'skip-stuck'` for a combo a prior cycle left `in-progress` (crashed mid-cycle) → skip with a warning, needs manual review
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
1. fetchDaqiAlertsForCycle()         — getRollingDayWindow() [yesterday+today UK-local] then fetchDaqiAlerts()
   ├─ on throw → log with upstreamStatus, return null (cycle aborts, next cron tick retries)
   └─ on empty member array → log "No alert members", return
2. filterValidDaqiAlerts(members, threshold)
   └─ keep only: daqi >= threshold && validationStatus===2 && samplingPointId/siteId/date present && isWithinLast24Hours(date)
   └─ empty result → return
3. buildLatestDaqiReadingMap(validAlerts)   — snapshot NEWEST {date, daqi} per samplingPointId from the pre-dedup list
4. deduplicateAlertsOldestFirst(validAlerts, 'daqi')  — collapse rows sharing a samplingPointId; oldest date wins (breach-started time), highest daqi breaks ties
5. ensureCacheReadyForCycle('[DAQI]')      — cache health gate
   └─ if getSiteCacheSize() === 0: ensureSiteCachePopulated()
      └─ if still empty: log and skip cycle entirely
6. loadRecentStateRowsBySamplingPointId(db, uniqueCandidates)  — one bulk read of the latest state row per samplingPointId
7. For each unique candidate:
   a. enrichAlertWithLatestReading()  — attaches latestRicardoDate/latestRicardoDaqi from step 3, so state writes reflect Ricardo's newest reading rather than the (older) dedup breach-start values
   b. classifyAlert(existingRow, now):
      - 'skip-stuck'  → prior cycle left it in-progress (crashed) → log warning, skip (needs manual review)
      - 'update-only' → last Ricardo reading within 24h → updateStateForExistingAlert() (bump lastUpdatedFromRicardo/daqi from the enriched values, no notify)
      - 'new'         → no row, or quiet >24h → processAlertForUsers():
          i.   getRegionForSite(siteId)       — O(1) site cache lookup; siteId miss → skip with info log (retry next cycle)
          ii.  markAlertInProgress(db)        — upsert NEW event row (compound key samplingPointId + alert-started-timestamp)
          iii. Query USERS where locations.region == resolvedRegion
          iv.  getMatchingUsers()             — expand to one entry per user-location pair
          v.   sendNotificationsToUsers() (alertCycleUtils.js), for each user-location pair:
               - insertDaqiAuditEntry()       — daqi-alerts-audit row, status not-processed; on duplicate-key (11000) resolves to `false` instead of throwing
               - if `false`                   — already notified on an earlier cycle; log and skip the re-send (no Notify call)
               - otherwise: sendAlertToUser() — Notify API call
               - updateDaqiAuditEntry()       — status processed + notificationId
          vi.  If all notifications succeeded → markAlertProcessed()
8. Log cycle summary: counts of 'new' / 'update-only' / 'skip-stuck' verdicts
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
  "samplingPointId": 12340,
  "siteId": "UKA00212",
  "pollutant": "NO<sub>2</sub> (NO2)",
  "daqi": 9,
  "region": "Northern Ireland",
  "process-status": "processed",
  "alert-started-timestamp": "2026-05-20T03:00:00+01:00",
  "lastUpdatedFromRicardo": "2026-05-20T04:15:00+01:00"
}
```

`alert-started-timestamp` is set once, from the OLDEST reading kept by `deduplicateAlertsOldestFirst` (the breach-start time), and is one half of the unique compound key. `daqi` and `lastUpdatedFromRicardo` are instead kept current on every cycle from the NEWEST pre-dedup reading (via `buildLatestDaqiReadingMap`/`enrichAlertWithLatestReading`), so they always reflect Ricardo's latest measurement rather than the breach-start values. Each distinct breach event (separated by a >24h quiet gap from Ricardo) gets its own document; a repeat within 24h updates `lastUpdatedFromRicardo`/`daqi` on the same document without re-notifying (`classifyAlert` → `'update-only'`).

**Indexes:**

- Unique compound on `{ samplingPointId, 'alert-started-timestamp' }` (name: `samplingPointId_alertStarted_unique`) — one document per breach event; a beyond-24h gap starts a new event with a new `alert-started-timestamp`

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

**DAQI level label (`getDaqiLabel` / `getDaqiLabelTitle`)**

The payload does not send the raw numeric `daqi` value or a pollutant name — it sends a severity label derived from the daqi value:

| `alertDetail.daqi`                            | `daqi-level`  | `daqi-level-title` |
| --------------------------------------------- | ------------- | ------------------ |
| `7`–`9`                                       | `"high"`      | `"High"`           |
| `>= 10` (`DAQI_VERY_HIGH_THRESHOLD` constant) | `"very high"` | `"Very high"`      |

**SMS:**

```json
{
  "phoneNumber": "+447123456789",
  "templateId": "<SMS_DAQI_ALERT_TEMPLATE_ID>",
  "alertId": "12340-UKA00212-2026-05-20T03:00:00+01:00",
  "personalisation": {
    "location": "Belfast",
    "daqi-level": "high",
    "daqi-level-title": "High",
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
    "daqi-level": "high",
    "daqi-level-title": "High",
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

| Failure point                                         | Behaviour                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ricardo DAQI fetch throws (scheduler)                 | Logs with structured `upstreamStatus` (HTTP status, or `null` for network/timeout). Cycle aborts; next cron tick (15 min) retries.                                                                                                                                                                |
| Ricardo DAQI fetch throws (`/daqi-alert`)             | `mapUpstreamError` returns the upstream status (4xx→4xx, 5xx→5xx, network→502) with `upstreamStatus` in the response body.                                                                                                                                                                        |
| No member array / empty list                          | Logs info, exits cleanly                                                                                                                                                                                                                                                                          |
| Site cache empty + refresh fails (scheduler)          | Logs "site cache empty…skipping cycle", exits. Avoids masking an outage as "no alerts".                                                                                                                                                                                                           |
| Site cache empty + refresh fails (endpoint)           | Responds with `[]`. `regionResolver` returns `null` to signal the caller.                                                                                                                                                                                                                         |
| siteId not in cache (per-alert)                       | Warning log, alert is skipped this cycle, **left in `not-processed` state** so a later cycle can retry once the cache catches up                                                                                                                                                                  |
| Individual notification fails                         | Logs error, audit entry stays `not-processed`, `allSent` flips to false — `daqi-alert-processing-state` is **not** marked processed                                                                                                                                                               |
| Duplicate audit insert (`DB_ERROR_CODE` 11000)        | `insertDaqiAuditEntry` logs a warning and resolves `false` instead of throwing; `sendNotificationsToUsers` (in `alertCycleUtils.js`) treats `false` as "already notified" and skips the re-send (and the Notify call) for that recipient                                                          |
| Combo left `in-progress` by a crashed cycle           | `classifyAlert` returns `'skip-stuck'` — logged as a warning, skipped, needs manual review (the row is never auto-recovered)                                                                                                                                                                      |
| Combo confirmed by Ricardo within 24h                 | `classifyAlert` returns `'update-only'` — `lastUpdatedFromRicardo`/`daqi` are bumped from the latest reading, no re-notification                                                                                                                                                                  |
| Legacy BSON-Date rows (`daqi-alert-processing-state`) | Not applicable to this collection — `loadRecentStateRowsBySamplingPointId` uses a Mongo `.sort()` on `alert-started-timestamp`, which is always written as an ISO string here. (Contrast with the pollutant flow — see [POLLUTANT-ALERT-IMPLEMENTATION.md](./POLLUTANT-ALERT-IMPLEMENTATION.md).) |
| Service restarts between ticks                        | Immediate startup run catches any unprocessed alerts; `daqi-alert-processing-state` prevents re-processing already-sent ones                                                                                                                                                                      |

Failed `not-processed` entries in `daqi-alerts-audit` are the evidence trail for manual investigation. No automatic retry is performed beyond the next scheduled cron tick.

## Sequence Diagram (scheduler cycle)

```
Cron tick (every 15m)
   │
   ▼
processDaqiAlerts(db) ─────────► getRollingDayWindow()   [UK-local yesterday/today]
   │                                       │
   ▼                                       ▼
Ricardo /api/daqi_alerts ─────► response { member: [...] }
   │
   ▼
filterValidDaqiAlerts ─────────► [valid alerts: daqi≥threshold, validated, within 24h]
   │
   ▼
buildLatestDaqiReadingMap ─────► [newest {date, daqi} per samplingPointId, pre-dedup]
   │
   ▼
deduplicateAlertsOldestFirst ──► [unique candidates: oldest date wins, highest daqi tie-break]
   │
   ▼
ensureCacheReadyForCycle?
   │      site cache empty → ensureSiteCachePopulated() → still empty? → exit
   │
   ▼
loadRecentStateRowsBySamplingPointId ─► [latest state row per samplingPointId]
   │
   ▼
for each unique candidate:
   │
   ├─► enrichAlertWithLatestReading(candidate)
   │
   ├─► classifyAlert(existingRow, now)
   │      ├─ 'skip-stuck'  → warn, skip (needs manual review)
   │      ├─ 'update-only' → updateStateForExistingAlert (bump lastUpdatedFromRicardo/daqi, no notify)
   │      └─ 'new' ↓
   │
   ├─► getRegionForSite(siteId)
   │      └─ not in cache? info log + skip alert (retry next cycle)
   │
   ├─► markAlertInProgress(db, enrichedDetail)
   │
   ├─► USERS.find({ 'locations.region': region })
   │
   ├─► for each user-location pair (sendNotificationsToUsers):
   │      ├─► insertDaqiAuditEntry → daqi-alerts-audit (status: not-processed)
   │      │      └─ duplicate (11000)? → resolves false → skip re-send, no Notify call
   │      ├─► sendAlertToUser → Notify API
   │      └─► updateDaqiAuditEntry → status: processed, notificationId
   │
   └─► if all sent successfully → markAlertProcessed(db, enrichedDetail)
```
