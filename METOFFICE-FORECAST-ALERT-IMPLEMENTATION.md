# MetOffice Forecast Alert — Implementation Documentation

## Overview

This feature adds automated DAQI (Daily Air Quality Index) forecast alert notifications to `aqie-alert-back-end-service`. Every morning between 05:00–10:00 UTC the service fetches the latest 5-day forecast from `aqie-forecast-api`, checks whether any UK monitoring station has a High DAQI value (≥ 7) for today, identifies the affected regions, matches registered users to those regions, and sends SMS/email notifications via `aqie-notify-service`. The scheduler fires hourly across this window — the first tick where the upstream forecast data is current for today does the work; subsequent ticks short-circuit via the per-day `forecast-schedule-state` guard.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                    Hapi Server (server.js)                        │
│                                                                   │
│  forecast-alert-scheduler (plugin)                                │
│    │  fires on server 'start'                                     │
│    │  runs immediately + node-cron '0 5-10 * * *' (hourly window) │
│    ▼                                                              │
│  processForecastAlerts(db)   ◄── forecastAlertProcessor.js        │
│    │                                                              │
│    ├── forecastApiClient.js ──► GET /forecast (aqie-forecast-api) │
│    │                                                              │
│    ├── regionFinder.js       ──► 3-step GeoJSON region lookup      │
│    │                                                              │
│    ├── MongoDB: forecast-schedule-state  (daily de-dup)           │
│    ├── MongoDB: USERS                    (find by region)         │
│    ├── MongoDB: metoffice-forecast-audit (audit trail)            │
│    │                                                              │
│    └── notifyServiceClient.js ──► POST /send-notification         │
└───────────────────────────────────────────────────────────────────┘
```

---

## New Files

### 1. `src/users/utils/forecastApiClient.js`

Handles HTTP communication with `aqie-forecast-api`.

**`fetchForecast()`**

- `GET` to `${FORECAST_API_URL}/forecast`
- Returns the full response body:
  ```json
  {
    "message": "success",
    "forecasts": [...],
    "forecast-summary": {...}
  }
  ```
- Throws on non-2xx response with the status code and error body included in the message

---

### 2. `src/users/utils/forecastAlertProcessor.js`

Core business logic. Exported functions:

| Function                                                   | Description                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `processForecastAlerts(db)`                                | **Main entry point** — orchestrates the full daily cycle                                                                                         |
| `isCurrentDate(updatedStr)`                                | Returns `true` if an ISO timestamp string belongs to today (UTC)                                                                                 |
| `addRegionsToForecasts(forecasts)`                         | Calls `findRegion()` for each station and attaches a `region` field using the 3-step fallback (direct polygon → bounding-box → nearest centroid) |
| `filterHighDaqiForecasts(forecastsWithRegions, threshold)` | Keeps only stations where today's DAQI value `>= threshold`                                                                                      |
| `groupAlertsByRegion(alertIdentifiedArray)`                | Deduplicates to one entry per affected region                                                                                                    |
| `getDaqiLabel()`                                           | Returns `"high"` — any DAQI breach (≥ 7) is classified as High                                                                                   |
| `buildAuditEntries(users, regionAlerts, forecastDate)`     | Builds one audit record per user-location pair for each alert region                                                                             |

---

### 3. `src/plugins/forecast-alert-scheduler.js`

A Hapi plugin that owns the daily timer, using `node-cron` for scheduling.

- Registers on **`server.start`** event
- **Runs `processForecastAlerts` immediately on startup** — handles restarts that occur within the daily window where one or more cron ticks have already been missed. `processForecastAlerts` skips gracefully if already completed today via the `forecast-schedule-state` check
- Schedules subsequent runs via `node-cron` using the cron expression from config (default: `0 5-10 * * *` — hourly between 05:00 and 10:00 UTC, covering 06:00–11:00 BST and 05:00–10:00 GMT). The processor's per-day `forecast-schedule-state` guard ensures only the first tick with current upstream data does the work
- Stops the cron job cleanly via `server.ext('onPostStop')` on server shutdown

---

## Modified Files

### `src/config.js` — two new config blocks

```
forecastAlertTemplates
  ├── smsAlert          env: SMS_FORECAST_ALERT_TEMPLATE_ID
  ├── smsAlertCy        env: SMS_FORECAST_ALERT_CY_TEMPLATE_ID
  ├── emailAlert        env: EMAIL_FORECAST_ALERT_TEMPLATE_ID
  └── emailAlertCy      env: EMAIL_FORECAST_ALERT_CY_TEMPLATE_ID

metOfficeForecast
  ├── forecastApiUrl     env: FORECAST_API_URL          (default: http://localhost:3005)
  ├── daqiAlertThreshold env: DAQI_ALERT_THRESHOLD      (default: 7)
  └── cronSchedule       env: FORECAST_CRON_SCHEDULE    (default: '0 5-10 * * *')
```

### `src/common/helpers/mongodb.js`

Added three new indexes at startup:

```js
// fast queries by date
db.collection('metoffice-forecast-audit').createIndex({ forecastDate: 1 })

// prevents duplicate audit entries if scheduler fires twice on the same day
db.collection('metoffice-forecast-audit').createIndex(
  { forecastDate: 1, user_contact: 1, location: 1, region: 1 },
  { unique: true }
)

// one state record per day
db.collection('forecast-schedule-state').createIndex(
  { forecastDate: 1 },
  { unique: true }
)
```

### `src/server.js`

- Imported and registered `forecastAlertScheduler` as a Hapi plugin alongside `pollutantAlertScheduler`.
- Also registers `initSiteCache()` via `server.ext('onPreStart')` and `stopSiteCache()` via `server.ext('onPreStop')` for the pollutant alert site-region cache (not used by the forecast flow, but part of the same server lifecycle).

---

## Step-by-Step Processing Flow

### Step 1 — Scheduler triggers `processForecastAlerts`

`forecast-alert-scheduler.js` calls `processForecastAlerts(db)` in two situations:

1. **On `server.start`** — immediately, every time the service starts. Handles restarts where one or more cron ticks have already been missed for the day.
2. **Via `node-cron`** — hourly between 05:00 and 10:00 UTC (`0 5-10 * * *`).

In both cases `processForecastAlerts` begins with the same de-dup check.

Before doing anything, the processor checks **`forecast-schedule-state`** to see if today's cycle has already completed:

```js
db.collection('forecast-schedule-state').findOne({ forecastDate: '2026-04-02' })
// { status: 'completed' } → skip and return
// null                    → proceed
```

This protects against duplicate processing on service restarts during the day.

---

### Step 2 — Fetch forecast data

`forecastApiClient.fetchForecast()` makes:

```
GET ${FORECAST_API_URL}/forecast
```

Response structure (approx. 5800 monitoring stations):

```json
{
  "message": "success",
  "forecasts": [
    {
      "name": "SOUTHAMPTON AIRPORT",
      "updated": "2026-04-02T06:00:00.000Z",
      "location": {
        "type": "Point",
        "coordinates": [50.9503, -1.3567]
      },
      "forecast": [
        { "day": "Thu", "value": 8 },
        { "day": "Fri", "value": 7 },
        { "day": "Sat", "value": 3 },
        { "day": "Sun", "value": 2 },
        { "day": "Mon", "value": 2 }
      ]
    }
  ]
}
```

**Date validation (`isCurrentDate`)**

The processor checks whether any station's `updated` field starts with today's date string (e.g. `"2026-04-02"`):

```js
forecasts.some((f) => f.updated.startsWith('2026-04-02'))
```

- **No current date found** → logs `"MetOffice forecast data not available for the day"` and stops. No DB writes — the next cron tick in the daily window will retry. If all ticks in the window fail to find current data, the next attempt is the first tick tomorrow.
- **Current date confirmed** → continues to Step 3.

---

### Step 3 — Resolve UK region for each monitoring station

`addRegionsToForecasts()` iterates all ~5800 stations and calls `findRegion(lat, long)` from `regionFinder.js` for each one. The coordinates array in the API response is `[lat, long]`.

`regionFinder.js` uses `@turf/boolean-point-in-polygon` against four GeoJSON boundary files (`England.GeoJSON`, `NorthernIreland.GeoJSON`, `Wales.GeoJSON`, `Scotland.GeoJSON`) covering 18 ITL regions. These files are loaded once at module level using `readFileSync` — the `regions[]` array is fully populated before the server accepts requests, so every `findRegion()` call reads from memory with no disk I/O.

> **Note:** `findRegion()` is shared between both alert schedulers. The forecast flow calls it here (per monitoring station, at alert-processing time). The pollutant flow calls it at startup via `initSiteCache()` to pre-build a `siteId → region` Map, then uses that Map for O(1) lookups during alert processing. See [POLLUTANT-ALERT-IMPLEMENTATION.md](./POLLUTANT-ALERT-IMPLEMENTATION.md#region-resolution--site-region-cache) for the full explanation of why the two schedulers use different loading strategies.

```js
// Before
{ name: "SOUTHAMPTON AIRPORT", location: { coordinates: [50.9503, -1.3567] }, forecast: [...] }

// After addRegionsToForecasts()
{ name: "SOUTHAMPTON AIRPORT", ..., region: "England" }
```

Stations outside all four boundaries get `region: "Unknown"` and are excluded from all downstream processing.

---

### Step 4 — Filter stations with today's DAQI ≥ threshold

`filterHighDaqiForecasts()` takes **only `forecast[0]`** (today's value) from each station. Future days in the 5-day forecast are ignored.

```js
// threshold = 7 (configurable via DAQI_ALERT_THRESHOLD)
// forecast[0].value >= 7 → keep
// forecast[0].value < 7  → discard
```

The result is `alertIdentifiedArray` — the subset of stations breaching the threshold today.

Example:

```
5800 stations total
 → 3200 have today value < 7  (discarded)
 → 2600 have today value >= 7 (kept in alertIdentifiedArray)
```

If `alertIdentifiedArray` is empty → logs `"No high DAQI forecasts today — no alerts to send"`, marks today as complete in `forecast-schedule-state`, and stops.

---

### Step 5 — Identify alert regions

`groupAlertsByRegion()` deduplicates `alertIdentifiedArray` to a unique set of region names. Stations with `region: "Unknown"` are skipped.

Given the MetOffice 12km grid resolution, **a single breaching station is enough to trigger alerts for all users registered in that region**.

```js
// alertIdentifiedArray may contain 2600 entries but only 2 unique regions
alertIdentifiedArray → regionAlerts = [
  { region: "England" },
  { region: "Wales" }
]

alertRegions = ["England", "Wales"]
```

---

### Step 5 continued — Fetch registered users

```js
db.collection('USERS').find({
  'locations.region': { $in: ['England', 'Wales'] }
})
```

Returns all users who have at least one registered location in an alert region.

Example USERS document:

```json
{
  "user_contact": "alice@example.com",
  "alertType": "email",
  "lang": "en",
  "locations": [
    { "location": "Bristol", "region": "England" },
    { "location": "Gloucester", "region": "England" }
  ]
}
```

---

### Step 5 continued — Build audit entries

`buildAuditEntries()` produces **one audit record per user-location pair per alert region**. It iterates:

```
for each region in regionAlerts
  for each user returned from USERS
    for each location in user.locations where location.region === region
      → create one audit entry
```

So Alice above, registered in England (2 locations), receives **2 audit entries** and **2 notifications** — one per location.

Audit entry shape at this point:

```json
{
  "forecastDate": "2026-04-02",
  "user_contact": "alice@example.com",
  "alertType": "email",
  "lang": "en",
  "location": "Bristol",
  "region": "England",
  "forecast-alert-status": "not-processed",
  "notificationId": null,
  "timestamp": "2026-04-02T06:01:43.000Z"
}
```

---

### Step 5 continued — Insert into `metoffice-forecast-audit`

`insertAuditEntries()` inserts each entry using `insertOne`. The unique compound index `{ forecastDate, user_contact, location, region }` prevents duplicate records if the function is ever called more than once for the same day. Duplicate key errors (code `11000`) are caught and logged as warnings — they do not abort the cycle.

**DB state after insertion (all entries `not-processed`):**

| forecastDate | user_contact        | alertType | location   | region   | forecast-alert-status | notificationId |
| ------------ | ------------------- | --------- | ---------- | -------- | --------------------- | -------------- |
| 2026-04-02   | alice@example.com   | email     | Bristol    | England  | not-processed         | null           |
| 2026-04-02   | alice@example.com   | email     | Gloucester | England  | not-processed         | null           |
| 2026-04-02   | bob@example.com     | sms       | London     | England  | not-processed         | null           |
| 2026-04-02   | charlie@example.com | email     | Edinburgh  | Scotland | not-processed         | null           |

---

### Step 6 — Send notifications via `aqie-notify-service`

`sendForecastAlertsToUsers()` iterates every audit entry and dispatches a notification for each one.

---

#### Language-aware template selection

The `lang` field on every audit entry is sourced directly from the USERS document:

```
USERS.lang ("cy")
  └─► buildAuditEntries() stores it on every audit entry
        └─► sendForecastAlertsToUsers() reads entry.lang
              └─► getTemplateId(entry.alertType, entry.lang)
                    └─► picks the correct Notify template ID
```

USERS document example (Welsh-language user):

```json
{
  "user_contact": "+447700900456",
  "alertType": "sms",
  "lang": "cy",
  "locations": [{ "location": "Cardiff", "region": "Wales" }]
}
```

Audit entry created for this user:

```json
{
  "user_contact": "+447700900456",
  "alertType":    "sms",
  "lang":         "cy",
  "location":     "Cardiff",
  "region":       "Wales",
  ...
}
```

`getTemplateId("sms", "cy")` → `config.get('forecastAlertTemplates.smsAlertCy')` → `SMS_FORECAST_ALERT_CY_TEMPLATE_ID`

**Full template resolution matrix:**

| alertType | lang | Config key                            | Env variable                          |
| --------- | ---- | ------------------------------------- | ------------------------------------- |
| `sms`     | `en` | `forecastAlertTemplates.smsAlert`     | `SMS_FORECAST_ALERT_TEMPLATE_ID`      |
| `sms`     | `cy` | `forecastAlertTemplates.smsAlertCy`   | `SMS_FORECAST_ALERT_CY_TEMPLATE_ID`   |
| `email`   | `en` | `forecastAlertTemplates.emailAlert`   | `EMAIL_FORECAST_ALERT_TEMPLATE_ID`    |
| `email`   | `cy` | `forecastAlertTemplates.emailAlertCy` | `EMAIL_FORECAST_ALERT_CY_TEMPLATE_ID` |

If a USERS document has no `lang` field it defaults to `"en"`.

The `lang` field is also persisted on the `metoffice-forecast-audit` document so you can audit exactly which language template was dispatched to each user.

---

**DAQI label** (`getDaqiLabel`):

Any breach (≥ 7) → `"high"`. No distinction between High (7–8) and Very High (9–10) in the current notification template.

**Date formatting:**

| Channel | Format function      | Example output        |
| ------- | -------------------- | --------------------- |
| SMS     | `formatTodayShort()` | `"Thu 03 Apr"`        |
| Email   | `formatTodayLong()`  | `"Thursday 03 April"` |

---

**Notification payload sent to `aqie-notify-service` POST `/send-notification`:**

SMS (English):

```json
{
  "phoneNumber": "+447700900123",
  "templateId": "<SMS_FORECAST_ALERT_TEMPLATE_ID>",
  "personalisation": {
    "location": "London",
    "daqi": "high",
    "today": "Thu 03 Apr",
    "checkAirQualityLink": "https://check-air-quality.service.gov.uk/location/london?lang=en"
  }
}
```

SMS (Welsh):

```json
{
  "phoneNumber": "+447700900456",
  "templateId": "<SMS_FORECAST_ALERT_CY_TEMPLATE_ID>",
  "personalisation": {
    "location": "Cardiff",
    "daqi": "high",
    "today": "Thu 03 Apr",
    "checkAirQualityLink": "https://check-air-quality.service.gov.uk/location/cardiff?lang=cy"
  }
}
```

Email (English):

```json
{
  "emailAddress": "alice@example.com",
  "templateId": "<EMAIL_FORECAST_ALERT_TEMPLATE_ID>",
  "personalisation": {
    "location": "Bristol",
    "daqi": "high",
    "today": "Thursday 03 April",
    "checkAirQualityLink": "https://check-air-quality.service.gov.uk/location/bristol?lang=en",
    "unsubscribeLink": "https://.../unsubscribe-email-link?email=alice%40example.com"
  }
}
```

Email (Welsh):

```json
{
  "emailAddress": "dewi@example.com",
  "templateId": "<EMAIL_FORECAST_ALERT_CY_TEMPLATE_ID>",
  "personalisation": {
    "location": "Swansea",
    "daqi": "high",
    "today": "Thursday 03 April",
    "checkAirQualityLink": "https://check-air-quality.service.gov.uk/location/swansea?lang=cy",
    "unsubscribeLink": "https://.../unsubscribe-email-link?email=dewi%40example.com"
  }
}
```

**`checkAirQualityLink` slug rules**

The URL path segment is built by `formatLocationForUrl(location)` from `src/users/utils/locationUtils.js` (shared with the pollutant scheduler). Rules:

| Input location                | Resulting slug               | Notes                                                                                                                                       |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `N8 7GE, Hornsey`             | `n87ge`                      | First part is a UK postcode → use postcode alone (lowercased, spaces stripped); locality is dropped to match the front-end's postcode route |
| `TW18 3HT, Egham`             | `tw183ht`                    | Same — postcode-prefixed                                                                                                                    |
| `London, City of Westminster` | `london_city-of-westminster` | First part is not a postcode → both parts slugged with `-`, joined with `_`                                                                 |
| `London Apprentice, Cornwall` | `london-apprentice_cornwall` | Same — non-postcode                                                                                                                         |
| `TW18 3HT` (no comma)         | `tw183ht`                    | Single token → lowercased, spaces stripped                                                                                                  |

Postcode detection is case-insensitive and accepts the postcode with or without an internal space. All four UK nations are covered (`BT` Northern Ireland, `EH`/`G`/`AB` Scotland, `CF`/`LL`/`SA` Wales, plus all England formats and Crown Dependencies).

**After a successful notification**, the audit entry is updated:

```js
db.collection('metoffice-forecast-audit').updateOne(
  {
    forecastDate,
    user_contact,
    location,
    region,
    'forecast-alert-status': 'not-processed'
  },
  {
    $set: {
      'forecast-alert-status': 'processed',
      notificationId: '<uuid-from-notify>'
    }
  }
)
```

**If notification fails**, the error is logged and the loop continues with the next entry. The audit entry remains with `forecast-alert-status: "not-processed"` and `notificationId: null`. There is no automatic retry — the `metoffice-forecast-audit` collection serves as the permanent evidence of what was sent and what failed.

**DB state after Step 6 (success scenario):**

| forecastDate | user_contact        | location   | region   | forecast-alert-status | notificationId |
| ------------ | ------------------- | ---------- | -------- | --------------------- | -------------- |
| 2026-04-02   | alice@example.com   | Bristol    | England  | processed             | a1b2c3d4-...   |
| 2026-04-02   | alice@example.com   | Gloucester | England  | processed             | b2c3d4e5-...   |
| 2026-04-02   | bob@example.com     | London     | England  | processed             | c3d4e5f6-...   |
| 2026-04-02   | charlie@example.com | Edinburgh  | Scotland | processed             | d4e5f6a7-...   |

---

### Step 6 continued — Mark day complete

Once all notifications have been attempted, `markScheduleComplete()` writes to **`forecast-schedule-state`**:

```json
{
  "forecastDate": "2026-04-02",
  "status": "completed",
  "completedAt": "2026-04-02T06:03:55.000Z"
}
```

This is the guard checked at the very start of the next invocation (e.g. if the service restarts the same day).

---

## MongoDB Collections

### `USERS` (existing — read-only by this feature)

```json
{
  "user_contact": "alice@example.com",
  "alertType": "email",
  "lang": "en",
  "locations": [
    { "location": "Bristol", "region": "England" },
    { "location": "Gloucester", "region": "England" }
  ]
}
```

### `metoffice-forecast-audit` (new)

| Field                   | Type           | Description                                              |
| ----------------------- | -------------- | -------------------------------------------------------- |
| `forecastDate`          | String         | `"YYYY-MM-DD"` — the date the cycle ran                  |
| `user_contact`          | String         | Email address or phone number                            |
| `alertType`             | String         | `"email"` or `"sms"`                                     |
| `lang`                  | String         | `"en"` or `"cy"` — determines which template was used    |
| `location`              | String         | The specific registered location name                    |
| `region`                | String         | UK country the alert applies to                          |
| `forecast-alert-status` | String         | `"not-processed"` → `"processed"`                        |
| `notificationId`        | String \| null | UUID returned by `aqie-notify-service`; `null` if failed |
| `timestamp`             | Date           | When the audit entry was created                         |

**Indexes:**

- `{ forecastDate: 1 }` — range queries by date
- `{ forecastDate, user_contact, location, region }` unique — prevents duplicate entries

**Status lifecycle:**

```
insertAuditEntries()
        │
        ▼
  "not-processed"   ← written before any notification attempt
        │
        ▼
  "processed"       ← written after aqie-notify-service returns successfully
        │
        └─ notificationId populated with the UUID from notify service

  [if notification fails]
  "not-processed" remains — visible in collection for manual investigation
```

### `forecast-schedule-state` (new)

| Field          | Type   | Description                       |
| -------------- | ------ | --------------------------------- |
| `forecastDate` | String | `"YYYY-MM-DD"`                    |
| `status`       | String | `"completed"`                     |
| `completedAt`  | Date   | Timestamp when the cycle finished |

**Index:** `{ forecastDate: 1 }` unique

One document per day. Queried at the top of each cycle to skip re-processing on service restarts.

---

## Log Prefixes

All log statements in `forecastAlertProcessor.js` and `forecastApiClient.js` are prefixed with `[Forecast]` to distinguish them from pollutant alert logs when both schedulers run concurrently.

---

## `regionFinder` — Unknown Region Warnings

When `findRegion(lat, long)` cannot match a station's coordinates to any UK boundary it returns `'Unknown'` and logs a `WARN`. This is expected for:

- **Isle of Man** — Crown Dependency, not covered by the four GeoJSON boundaries
- **Outer Scottish islands** (Hebrides, Orkney, Shetland) — depending on boundary polygon detail
- **Offshore stations** — ships and buoys located in the sea

These stations are silently excluded in `groupAlertsByRegion` (`region !== 'Unknown'`) and never trigger user notifications. The warnings do not affect the processing flow.

---

## Multi-Location Behaviour

A user registered in multiple locations within the **same region** receives one notification per location — by design:

```
User: alice@example.com
Locations: Bristol (England), Gloucester (England)
Alert Region: England

→ 2 audit entries inserted
→ 2 email notifications sent — one for Bristol, one for Gloucester
```

---

## Environment Variables

| Variable                              | Default                 | Required |
| ------------------------------------- | ----------------------- | -------- |
| `FORECAST_API_URL`                    | `http://localhost:3005` | Yes      |
| `DAQI_ALERT_THRESHOLD`                | `7`                     | No       |
| `FORECAST_CRON_SCHEDULE`              | `0 5-10 * * *`          | No       |
| `SMS_FORECAST_ALERT_TEMPLATE_ID`      | _(empty)_               | Yes      |
| `SMS_FORECAST_ALERT_CY_TEMPLATE_ID`   | _(empty)_               | Yes      |
| `EMAIL_FORECAST_ALERT_TEMPLATE_ID`    | _(empty)_               | Yes      |
| `EMAIL_FORECAST_ALERT_CY_TEMPLATE_ID` | _(empty)_               | Yes      |

---

## Sequence Diagram

```
Scheduler       ForecastApiClient    regionFinder    MongoDB              NotifyService
    │                  │                  │              │                     │
    │ on server start  │                  │              │                     │
    │ (or 05-10 UTC    │                  │              │                     │
    │  hourly cron)    │                  │              │                     │
    │──────────────────────────────────────              │                     │
    │                  │                  │              │                     │
    │       check forecast-schedule-state ──────────────►│                     │
    │◄──────────────────────────────────────────────────│                     │
    │ (skip if completed today)            │              │                     │
    │                  │                  │              │                     │
    │── GET /forecast ─►                  │              │                     │
    │◄── { forecasts } ─                  │              │                     │
    │                  │                  │              │                     │
    │ check updated field (isCurrentDate) │              │                     │
    │ [not today] → log & stop            │              │                     │
    │ [today]     → continue              │              │                     │
    │                  │                  │              │                     │
    │  [for each of ~5800 stations]       │              │                     │
    │────────────────── findRegion(lat,long) ──────────► │ (GeoJSON check)     │
    │◄──────────────────────────────────── region name   │                     │
    │                  │                  │              │                     │
    │ filterHighDaqiForecasts (today value >= 7)         │                     │
    │ groupAlertsByRegion (unique regions)               │                     │
    │                  │                  │              │                     │
    │  query USERS by region ────────────────────────── ►│                     │
    │◄── matching users ─────────────────────────────── │                     │
    │                  │                  │              │                     │
    │  buildAuditEntries (one per user-location pair)    │                     │
    │  insertAuditEntries ──────────────────────────────►│ (not-processed)     │
    │                  │                  │              │                     │
    │  [for each audit entry]             │              │                     │
    │──────────────────────────────────────────────────── POST /send-notification ►
    │◄──────────────────────────────────────────────────────── { notificationId } │
    │  update audit entry (processed + notificationId) ─►│                     │
    │                  │                  │              │                     │
    │  markScheduleComplete ────────────────────────────►│                     │
    │                  │                  │              │                     │
    │  node-cron schedules next ticks 05-10 UTC tomorrow │                     │
```

---

## Error Handling Summary

| Failure point                                           | Behaviour                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /forecast` throws                                  | Logs error, cycle stops, next cron tick in today's window will retry                                                       |
| `updated` field not today                               | Logs `"MetOffice forecast data not available for the day"`, cycle stops, no DB writes — next tick in the window will retry |
| No stations breach threshold                            | Logs info, marks day complete in `forecast-schedule-state`, no notifications sent                                          |
| Individual notification fails                           | Logs error, audit entry stays `not-processed`, cycle continues for remaining entries                                       |
| Duplicate audit insert (code 11000)                     | Logs warning, skips insert, continues                                                                                      |
| Service restarts **before** the window (pre-05:00 UTC)  | Immediate startup run executes; data not yet available → logs and stops; cron fires from 05:00 UTC as normal               |
| Service restarts **inside** the window, job already ran | Immediate startup run executes; `forecast-schedule-state` shows completed → skips                                          |
| Service restarts **inside** the window, job not yet run | Immediate startup run executes and processes normally; cron continues to fire for the remainder of the window              |

Failed `not-processed` entries in `metoffice-forecast-audit` are the evidence trail for manual investigation. No automatic retry is performed.
