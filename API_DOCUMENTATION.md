# AQIE Alert Back-End Service — API Documentation

## Overview

The AQIE (Air Quality Information Exchange) Alert Back-End Service manages air quality alert subscriptions. Users register for location-based SMS or email notifications when air quality conditions in their area are poor, and can unsubscribe at any time.

**Base URL (development):** `http://localhost:3001`  
**Authentication:** None — all endpoints are public  
**Content-Type:** `application/json`

---

## Endpoints Summary

| Method   | Path                   | Description                                                           |
| -------- | ---------------------- | --------------------------------------------------------------------- |
| `GET`    | `/health`              | Service health check                                                  |
| `POST`   | `/setup-alert`         | Subscribe a user to air quality alerts                                |
| `DELETE` | `/opt-out-sms-alert`   | Unsubscribe an SMS user                                               |
| `DELETE` | `/opt-out-email-alert` | Unsubscribe an email user                                             |
| `GET`    | `/aqsr-alert`          | Query AQSR breach alerts by current location (lat/long) or date range |
| `GET`    | `/daqi-alert`          | Query DAQI breach alerts for the region resolved from lat/long        |

---

## GET /health

Returns the service health status.

**Response 200:**

```json
{ "message": "success" }
```

---

## POST /setup-alert

Registers a user for air quality alerts at a specific location. A confirmation notification (SMS or email) is dispatched **before** the record is persisted — if the notification fails, nothing is saved.

**Request Body:**

```json
{
  "alertType": "email",
  "emailAddress": "user@example.com",
  "location": "Bristol, South West England",
  "lat": 51.4545,
  "long": -2.5879,
  "lang": "en"
}
```

```json
{
  "alertType": "sms",
  "phoneNumber": "07123456789",
  "location": "Bristol, South West England",
  "lat": 51.4545,
  "long": -2.5879,
  "lang": "en"
}
```

**Fields:**

| Field          | Type   | Required                      | Description                                                                      |
| -------------- | ------ | ----------------------------- | -------------------------------------------------------------------------------- |
| `alertType`    | string | Yes                           | `"sms"` or `"email"`                                                             |
| `phoneNumber`  | string | When `alertType` is `"sms"`   | UK mobile number — `07xxxxxxxxx` or `+447xxxxxxxxx`. Spaces and dashes accepted. |
| `emailAddress` | string | When `alertType` is `"email"` | Valid email address. Trimmed and lowercased before storage.                      |
| `location`     | string | Yes                           | Human-readable location name                                                     |
| `lat`          | number | Yes                           | Latitude of the location                                                         |
| `long`         | number | Yes                           | Longitude of the location                                                        |
| `lang`         | string | Yes                           | `"en"` (English) or `"cy"` (Welsh) — controls notification template language     |

**Validation rules:**

- `lang` must be `"en"` or `"cy"`
- `alertType` must be `"sms"` or `"email"`
- `phoneNumber` required when `alertType` is `"sms"` — must be a valid UK mobile number
- `emailAddress` required when `alertType` is `"email"` — normalized to lowercase and trimmed before use
- `location`, `lat`, and `long` are always required
- A user may register up to **5 locations**. A sixth attempt returns `400`
- Duplicate coordinates for the same user contact return `409`

**Success Response (201):**

```json
{
  "message": "Alert setup successful",
  "userId": "507f1f77bcf86cd799439011"
}
```

**Error Responses:**

| Status                      | Condition                                                |
| --------------------------- | -------------------------------------------------------- |
| `400 Bad Request`           | Missing or invalid fields, or 5-location limit reached   |
| `409 Conflict`              | Alert already exists for this exact location             |
| `502 Bad Gateway`           | Notification service unavailable or rejected the contact |
| `500 Internal Server Error` | Database or system error                                 |

---

## DELETE /opt-out-sms-alert

Removes a user's SMS alert subscription. Deletes the user's document from the `USERS` collection.

**Request Body:**

```json
{
  "phoneNumber": "07123456789"
}
```

**Validation rules:**

- `phoneNumber` must be a non-empty string
- Must match a valid UK mobile number format: `07xxxxxxxxx` or `+447xxxxxxxxx`
- Spaces and dashes in the number are stripped before validation

**Success Response (200):**

```json
{
  "success": true,
  "phoneNumber": "07123456789"
}
```

**Error Responses:**

| Status                      | Condition                                                        |
| --------------------------- | ---------------------------------------------------------------- |
| `400 Bad Request`           | Missing `phoneNumber`, not a string, or invalid UK mobile format |
| `404 Not Found`             | No user found for this phone number                              |
| `500 Internal Server Error` | Database or system error                                         |

---

## DELETE /opt-out-email-alert

Removes a user's email alert subscription. Deletes the user's document from the `USERS` collection.

**Request Body:**

```json
{
  "emailAddress": "user@example.com"
}
```

**Validation rules:**

- `emailAddress` must be a non-empty string
- Must be a valid email format — GDS-aligned pattern: no TLD required (e.g. `user@localhost` is accepted)
- Normalized to lowercase and trimmed before the database lookup

**Success Response (200):**

```json
{
  "success": true,
  "emailAddress": "user@example.com"
}
```

**Error Responses:**

| Status                      | Condition                                                     |
| --------------------------- | ------------------------------------------------------------- |
| `400 Bad Request`           | Missing `emailAddress`, not a string, or invalid email format |
| `404 Not Found`             | No user found for this email address                          |
| `500 Internal Server Error` | Database or system error                                      |

---

## GET /aqsr-alert

Queries Ricardo AQSR (Air Quality Standards Regulation) breach alerts. Supports two mutually exclusive modes.

### Mode 1 — Current-day (location scoped)

Returns active alerts within the last 24 hours for the region the supplied coordinates fall in.

**Query Parameters:**

| Parameter     | Type    | Required | Description                        |
| ------------- | ------- | -------- | ---------------------------------- |
| `current-day` | boolean | Yes      | Must be `true`                     |
| `lat`         | number  | Yes      | Latitude of the location to check  |
| `long`        | number  | Yes      | Longitude of the location to check |

**Example:**

```
GET /aqsr-alert?current-day=true&lat=51.4818&long=-3.1763
```

**How it works:**

1. `lat`/`long` are resolved to a UK region via the 3-step GeoJSON boundary lookup (polygon → bounding-box → nearest centroid)
2. All monitoring site IDs for that region are retrieved from the in-memory site-region cache
3. The Ricardo AQSR alerts feed is fetched with `start-date` = yesterday's UK-local date (`Europe/London`) and `end-date` = today's UK-local date (both `yyyy-mm-dd`), narrowing the upstream response to the rolling 24-hour window. When `RICARDO_API_USE_MOCK=true`, the mock response is returned to the caller after the real call is logged.
4. Alerts are filtered to those where the site ID matches the region's sites, the alert is confirmed (`alertLevel=true` or `informationLevel=true`), and the date is within the last 24 hours (precise millisecond check)
5. Each alert's `alert-started` timestamp is Ricardo's `date` value, returned unmodified

---

### Mode 2 — Date range (global)

Returns all confirmed breach alerts (`alertLevel=true` or `informationLevel=true`) across all regions for the given period. No location filter applied.

**Query Parameters:**

| Parameter    | Type   | Required | Description                                       |
| ------------ | ------ | -------- | ------------------------------------------------- |
| `start-date` | string | Yes      | Start of period — `yyyy-mm-dd` format             |
| `end-date`   | string | Yes      | End of period — `yyyy-mm-dd` format, ≥ start-date |

**Example:**

```
GET /aqsr-alert?start-date=2026-05-01&end-date=2026-05-08
```

---

### Response (both modes)

**200 OK** — array of alert objects (empty array when no alerts match). Records are **always sorted by `alert-started` in descending order (newest first)** regardless of the order Ricardo returns them, so the front-end can reliably show the latest breach at the top of the results page.

```json
[
  {
    "active-breaches": true,
    "sampling-id": 1187,
    "pollutant-name": "ozone (O3)",
    "concentration": 182.5,
    "monitoring-station-name": "Cardiff Centre",
    "region": "South East Wales",
    "alert-started": "2026-05-08T09:00:00+01:00"
  }
]
```

**Response fields:**

| Field                     | Type           | Description                                                                                                          |
| ------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `active-breaches`         | boolean        | `true` if the alert date is within the last 24 hours; `false` for historical ones                                    |
| `sampling-id`             | number \| null | Ricardo `samplingPointId` for the monitoring point that recorded the breach; `null` if absent in the upstream record |
| `pollutant-name`          | string         | Human-readable pollutant name e.g. `"ozone (O3)"`, `"nitrogen dioxide (NO2)"`                                        |
| `concentration`           | number \| null | Measured pollutant concentration for the breach, as reported by Ricardo; `null` if absent in the upstream record     |
| `monitoring-station-name` | string \| null | Name of the monitoring station from Ricardo site metadata; `null` if not cached                                      |
| `region`                  | string \| null | Region resolved from the site's coordinates; `null` if not in cache                                                  |
| `alert-started`           | string         | Ricardo's alert timestamp (`date`), returned unmodified — same as `/daqi-alert`                                      |

**Validation errors (400):**

| Condition                                      | Message                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Neither mode supplied                          | `Provide either current-day=true with lat and long, or start-date and end-date` |
| Both modes supplied simultaneously             | `Provide either current-day or start-date/end-date, not both`                   |
| `current-day=true` but `lat` or `long` missing | `lat and long are required for current-day mode`                                |
| `lat` or `long` not a valid number             | `lat and long must be valid numbers`                                            |
| `start-date` or `end-date` missing             | `Both start-date and end-date are required`                                     |
| Date not in `yyyy-mm-dd` format                | `start-date and end-date must be in yyyy-mm-dd format`                          |
| `end-date` before `start-date`                 | `end-date must be on or after start-date`                                       |

**Upstream error responses** — Errors from the Ricardo API are **passed through with the original status code** so failures can be diagnosed without inspecting server logs. The response body always includes an `upstreamStatus` field carrying the original code (or `null` when the call never reached upstream).

| Ricardo returns                       | This API returns  | Body                                                                                                                            |
| ------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 4xx (e.g. 401, 403, 404, 429)         | same 4xx          | `{ statusCode, error, message: "Air quality alert service rejected the request", upstreamStatus: <original> }`                  |
| 5xx (e.g. 500, 502, 503, 504)         | same 5xx          | `{ statusCode, error, message: "Air quality alert service upstream error", upstreamStatus: <original> }`                        |
| Network error / timeout / no response | `502 Bad Gateway` | `{ statusCode: 502, error: "Bad Gateway", message: "Air quality alert service temporarily unavailable", upstreamStatus: null }` |

The frontend can treat any non-2xx as "hide the alert banner" without parsing the body. `upstreamStatus` is intended for debugging from a browser dev tools network tab, not for user-facing logic.

---

## GET /daqi-alert

Returns active DAQI (Daily Air Quality Index) breach alerts for the region resolved from the supplied coordinates. Used by the front-end to surface "high air quality index" warnings for a user's current location.

**Query Parameters:**

| Parameter | Type   | Required | Description                        |
| --------- | ------ | -------- | ---------------------------------- |
| `lat`     | number | Yes      | Latitude of the location to check  |
| `long`    | number | Yes      | Longitude of the location to check |

**Example:**

```
GET /daqi-alert?lat=51.4818&long=-3.1763
```

**How it works:**

1. `lat`/`long` are resolved to a UK region via the 3-step GeoJSON boundary lookup (polygon → bounding-box → nearest centroid)
2. The site-region cache is checked. If it's empty, an on-demand refresh is attempted; if that fails the endpoint returns `[]` rather than mask the cache outage as "no alerts"
3. The Ricardo DAQI feed is fetched with `start-date` = yesterday's UK-local date (`Europe/London`) and `end-date` = today's UK-local date (both `yyyy-mm-dd`), narrowing the upstream response to the rolling 24-hour window
4. Members are filtered to those where:
   - `daqi >= threshold` (default `7`, configurable via `DAQI_ALERT_THRESHOLD`)
   - `validationStatus === 2` (Ricardo's "validated" flag)
   - The alert date is within the last 24 hours (precise millisecond check)
   - `getRegionForSite(siteId)` matches the region resolved in step 1 (region is always derived from `siteId` via the cache, never from Ricardo's coarse `region` field)
5. The result is sorted by `date` descending — newest alerts first

### Response

**200 OK** — array of alert objects (empty array when no alerts match):

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

**Response fields:**

| Field             | Type           | Description                                                                                                 |
| ----------------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `active-breaches` | boolean        | Always `true` — by the time the alert reaches this array it has passed the 24h + threshold + region filters |
| `pollutant-name`  | string         | Human-readable pollutant name e.g. `"ozone (O3)"`, `"nitrogen dioxide (NO2)"`                               |
| `daqi`            | number         | The DAQI index value reported by Ricardo (≥ threshold)                                                      |
| `samplingPointId` | number \| null | Ricardo's sampling point identifier                                                                         |
| `siteId`          | string \| null | Ricardo's monitoring site code (e.g. `"UKA00212"`)                                                          |
| `alert-started`   | string         | ISO 8601 timestamp when the alert was recorded by Ricardo                                                   |

### Empty array scenarios (200 OK)

The endpoint always returns `200` even when there are no results. An empty array `[]` is returned in these cases:

| Scenario                                                                    |
| --------------------------------------------------------------------------- |
| `lat`/`long` resolve to "Unknown" (outside known UK regions)                |
| The site cache is empty and an on-demand refresh attempt failed             |
| Ricardo returned no members for the date window                             |
| No members passed the `daqi >= threshold` + `validationStatus === 2` filter |
| All matching members are older than 24 hours                                |
| No matching member's site resolves to the caller's region                   |

### Validation errors (400)

| Condition                          | Message                              |
| ---------------------------------- | ------------------------------------ |
| `lat` or `long` missing            | `lat and long are required`          |
| `lat` or `long` not a valid number | `lat and long must be valid numbers` |

### Upstream error responses

Errors from the Ricardo DAQI API are **passed through with the original status code** so failures can be diagnosed without inspecting server logs. The response body always includes an `upstreamStatus` field carrying the original code (or `null` when the call never reached upstream). Same pattern as `/aqsr-alert` — the service name in the message changes to `"DAQI alert service"`.

| Ricardo returns                       | This API returns  | Body                                                                                                                     |
| ------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 4xx (e.g. 401, 403, 404, 429)         | same 4xx          | `{ statusCode, error, message: "DAQI alert service rejected the request", upstreamStatus: <original> }`                  |
| 5xx (e.g. 500, 502, 503, 504)         | same 5xx          | `{ statusCode, error, message: "DAQI alert service upstream error", upstreamStatus: <original> }`                        |
| Network error / timeout / no response | `502 Bad Gateway` | `{ statusCode: 502, error: "Bad Gateway", message: "DAQI alert service temporarily unavailable", upstreamStatus: null }` |

---

## Data Models

### USERS Collection

One document per unique `user_contact` (normalized phone number or lowercase email). Multiple locations are stored as an array within the same document.

```json
{
  "_id": "ObjectId",
  "user_contact": "user@example.com",
  "alertType": "email",
  "lang": "en",
  "createdAt": "2026-04-01T09:00:00.000Z",
  "requestId": "req-a1b2c3d4-...",
  "locations": [
    {
      "location": "Bristol, South West England",
      "coordinates": [-2.5879, 51.4545],
      "createdAt": "2026-04-01T09:00:00.000Z",
      "region": "England"
    }
  ]
}
```

**Notes:**

- `user_contact` stores the normalized phone number (`+447xxxxxxxxx`) for SMS users and the lowercased email address for email users
- `coordinates` are stored as `[longitude, latitude]` (GeoJSON order)
- `region` is resolved from lat/long at subscription time using a 3-step GeoJSON lookup (direct polygon, bounding-box, nearest centroid) — used by the alert schedulers to match users to affected areas
- **Unique index** on `user_contact` (`user_contact_unique`) enforces one document per subscriber

---

## Environment Variables

### Server

| Variable   | Default       | Description         |
| ---------- | ------------- | ------------------- |
| `NODE_ENV` | `development` | Runtime environment |
| `PORT`     | `3001`        | Server port         |
| `HOST`     | `0.0.0.0`     | Server bind address |

### MongoDB

| Variable         | Default                       | Description               |
| ---------------- | ----------------------------- | ------------------------- |
| `MONGO_URI`      | `mongodb://127.0.0.1:27017/`  | MongoDB connection string |
| `MONGO_DATABASE` | `aqie-alert-back-end-service` | Database name             |

### Notification Service (Setup Alert)

| Variable                                | Default                                                                         | Description                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `NOTIFICATION_SERVICE_URL`              | `http://localhost:3000/send-notification`                                       | aqie-notify-service endpoint                                  |
| `SMS_SET_UP_CONFIRMATION_TEMPLATE_ID`   | _(set in config)_                                                               | SMS setup confirmation Notify template ID                     |
| `EMAIL_SET_UP_CONFIRMATION_TEMPLATE_ID` | _(set in config)_                                                               | Email setup confirmation Notify template ID                   |
| `UNSUBSCRIBE_EMAIL_LINK`                | `https://aqie-front-end.test.cdp-int.defra.cloud/notify/unsubscribe-email-link` | Base URL for unsubscribe link embedded in email notifications |

### Pollutant Alert Scheduler

| Variable                        | Default                                              | Description                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RICARDO_API_EMAIL`             | _(set in config)_                                    | Ricardo API login email                                                                                                                                                         |
| `RICARDO_API_PASSWORD`          | _(set in config)_                                    | Ricardo API login password                                                                                                                                                      |
| `RICARDO_API_LOGIN_URL`         | `https://api-ukair.defra.gov.uk/api/login_check`     | Ricardo login endpoint                                                                                                                                                          |
| `RICARDO_API_ALERTS_URL`        | `https://api-ukair.defra.gov.uk/api/aqsr_alerts`     | Ricardo AQSR alerts endpoint                                                                                                                                                    |
| `RICARDO_API_SITE_METADATA_URL` | `https://api-ukair.defra.gov.uk/api/site_meta_datas` | Ricardo site metadata endpoint (used to build region cache)                                                                                                                     |
| `POLLUTANT_CRON_SCHEDULE`       | `*/15 * * * *`                                       | Cron expression for the pollutant alert polling job (every 15 minutes)                                                                                                          |
| `RICARDO_API_USE_MOCK`          | `true`                                               | When `true`, `fetchAlerts` returns hardcoded mock data. `getAccessToken` and `fetchSiteMetaData` always call the real API so the site-region cache is populated with live data. |
| `SMS_ALERT_TEMPLATE_ID`         | _(set in config)_                                    | SMS pollutant alert Notify template (English)                                                                                                                                   |
| `SMS_ALERT_CY_TEMPLATE_ID`      | _(set in config)_                                    | SMS pollutant alert Notify template (Welsh)                                                                                                                                     |
| `EMAIL_ALERT_TEMPLATE_ID`       | _(set in config)_                                    | Email pollutant alert Notify template (English)                                                                                                                                 |
| `EMAIL_ALERT_CY_TEMPLATE_ID`    | _(set in config)_                                    | Email pollutant alert Notify template (Welsh)                                                                                                                                   |
| `CHECK_AIR_QUALITY_LINK`        | `https://check-air-quality.service.gov.uk/location/` | Base URL for the "check air quality" link in alert notifications                                                                                                                |

### DAQI Alert Scheduler

| Variable                          | Default                                          | Description                                                       |
| --------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| `RICARDO_API_DAQI_ALERTS_URL`     | `https://api-ukair.defra.gov.uk/api/daqi_alerts` | Ricardo API DAQI alerts endpoint                                  |
| `DAQI_ALERT_CRON_SCHEDULE`        | `*/15 * * * *`                                   | Cron expression for the DAQI alert polling job (every 15 minutes) |
| `SMS_DAQI_ALERT_TEMPLATE_ID`      | _(set in config)_                                | SMS DAQI alert Notify template (English)                          |
| `SMS_DAQI_ALERT_CY_TEMPLATE_ID`   | _(set in config)_                                | SMS DAQI alert Notify template (Welsh)                            |
| `EMAIL_DAQI_ALERT_TEMPLATE_ID`    | _(set in config)_                                | Email DAQI alert Notify template (English)                        |
| `EMAIL_DAQI_ALERT_CY_TEMPLATE_ID` | _(set in config)_                                | Email DAQI alert Notify template (Welsh)                          |

The DAQI alert flow reuses `DAQI_ALERT_THRESHOLD` (from the MetOffice Forecast section below) since "what counts as high" is the same for both flows.

### MetOffice Forecast Alert Scheduler

| Variable                              | Default                 | Description                                                                                                                                                                                                                   |
| ------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORECAST_API_URL`                    | `http://localhost:3005` | aqie-forecast-api base URL                                                                                                                                                                                                    |
| `DAQI_ALERT_THRESHOLD`                | `7`                     | Minimum DAQI value (inclusive) that triggers an alert                                                                                                                                                                         |
| `FORECAST_CRON_SCHEDULE`              | `0 5-10 * * *`          | Cron expression for the forecast alert job — hourly 05:00–10:00 UTC (covers 06:00–11:00 BST / 05:00–10:00 GMT). Per-day `forecast-schedule-state` guard ensures only the first tick with current forecast data does the work. |
| `SMS_FORECAST_ALERT_TEMPLATE_ID`      | _(set in config)_       | SMS forecast alert Notify template (English)                                                                                                                                                                                  |
| `SMS_FORECAST_ALERT_CY_TEMPLATE_ID`   | _(set in config)_       | SMS forecast alert Notify template (Welsh)                                                                                                                                                                                    |
| `EMAIL_FORECAST_ALERT_TEMPLATE_ID`    | _(set in config)_       | Email forecast alert Notify template (English)                                                                                                                                                                                |
| `EMAIL_FORECAST_ALERT_CY_TEMPLATE_ID` | _(set in config)_       | Email forecast alert Notify template (Welsh)                                                                                                                                                                                  |

### Logging & Proxy

| Variable      | Default                            | Description                                                                         |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `LOG_LEVEL`   | `info`                             | Log level: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` |
| `LOG_FORMAT`  | `pino-pretty` (dev) / `ecs` (prod) | Log output format                                                                   |
| `LOG_ENABLED` | `true` (non-test)                  | Enable or disable logging                                                           |
| `HTTP_PROXY`  | _(none)_                           | HTTP proxy URL                                                                      |
| `HTTPS_PROXY` | _(none)_                           | HTTPS proxy URL                                                                     |
