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
3. The Ricardo AQSR alerts feed is fetched (or returned from mock when `RICARDO_API_USE_MOCK=true`)
4. Alerts are filtered to those where the site ID matches the region's sites, the alert is confirmed (`alertLevel=true` or `informationLevel=true`), and the date is within the last 24 hours

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

**200 OK** — array of alert objects (empty array when no alerts match):

```json
[
  {
    "active-breaches": true,
    "pollutant-name": "ozone (O3)",
    "monitoring-station-name": "Cardiff Centre",
    "region": "South East Wales",
    "alert-started": "2026-05-08T09:00:00+01:00"
  }
]
```

**Response fields:**

| Field                     | Type           | Description                                                                       |
| ------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `active-breaches`         | boolean        | `true` if the alert date is within the last 24 hours; `false` for historical ones |
| `pollutant-name`          | string         | Human-readable pollutant name e.g. `"ozone (O3)"`, `"nitrogen dioxide (NO2)"`     |
| `monitoring-station-name` | string \| null | Name of the monitoring station from Ricardo site metadata; `null` if not cached   |
| `region`                  | string \| null | Region resolved from the site's coordinates; `null` if not in cache               |
| `alert-started`           | string         | ISO 8601 timestamp when the alert was recorded by Ricardo                         |

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

**502 Bad Gateway** — Ricardo API unavailable (real API mode only).

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

| Variable                            | Default                                                     | Description                                                                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RICARDO_API_EMAIL`                 | _(set in config)_                                           | Ricardo API login email                                                                                                                                                         |
| `RICARDO_API_PASSWORD`              | _(set in config)_                                           | Ricardo API login password                                                                                                                                                      |
| `RICARDO_API_LOGIN_URL`             | `https://uk-air-api.staging.rcdo.co.uk/api/login_check`     | Ricardo login endpoint                                                                                                                                                          |
| `RICARDO_API_ALERTS_URL`            | `https://uk-air-api.staging.rcdo.co.uk/api/aqsr_alerts`     | Ricardo AQSR alerts endpoint                                                                                                                                                    |
| `RICARDO_API_SITE_METADATA_URL`     | `https://uk-air-api.staging.rcdo.co.uk/api/site_meta_datas` | Ricardo site metadata endpoint (used to build region cache)                                                                                                                     |
| `POLLUTANT_CRON_SCHEDULE`           | `*/30 * * * *`                                              | Cron expression for the pollutant alert polling job                                                                                                                             |
| `RICARDO_API_USE_MOCK`              | `true`                                                      | When `true`, `fetchAlerts` returns hardcoded mock data. `getAccessToken` and `fetchSiteMetaData` always call the real API so the site-region cache is populated with live data. |
| `SMS_ALERT_TEMPLATE_ID`             | _(set in config)_                                           | SMS pollutant alert Notify template (English)                                                                                                                                   |
| `SMS_ALERT_CY_TEMPLATE_ID`          | _(set in config)_                                           | SMS pollutant alert Notify template (Welsh)                                                                                                                                     |
| `EMAIL_ALERT_TEMPLATE_ID`           | _(set in config)_                                           | Email pollutant alert Notify template (English)                                                                                                                                 |
| `EMAIL_ALERT_CY_TEMPLATE_ID`        | _(set in config)_                                           | Email pollutant alert Notify template (Welsh)                                                                                                                                   |
| `CHECK_AIR_QUALITY_LINK`            | `https://check-air-quality.service.gov.uk/location/`        | Base URL for the "check air quality" link in alert notifications                                                                                                                |
| `RICARDO_REGION_SYNC_CRON_SCHEDULE` | `0 1 * * *`                                                 | Cron for the daily site-region cache refresh (1am)                                                                                                                              |

### MetOffice Forecast Alert Scheduler

| Variable                              | Default                 | Description                                           |
| ------------------------------------- | ----------------------- | ----------------------------------------------------- |
| `FORECAST_API_URL`                    | `http://localhost:3005` | aqie-forecast-api base URL                            |
| `DAQI_ALERT_THRESHOLD`                | `7`                     | Minimum DAQI value (inclusive) that triggers an alert |
| `FORECAST_CRON_SCHEDULE`              | `0 6 * * *`             | Cron expression for the daily forecast alert job      |
| `SMS_FORECAST_ALERT_TEMPLATE_ID`      | _(set in config)_       | SMS forecast alert Notify template (English)          |
| `SMS_FORECAST_ALERT_CY_TEMPLATE_ID`   | _(set in config)_       | SMS forecast alert Notify template (Welsh)            |
| `EMAIL_FORECAST_ALERT_TEMPLATE_ID`    | _(set in config)_       | Email forecast alert Notify template (English)        |
| `EMAIL_FORECAST_ALERT_CY_TEMPLATE_ID` | _(set in config)_       | Email forecast alert Notify template (Welsh)          |

### Logging & Proxy

| Variable      | Default                            | Description                                                                         |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `LOG_LEVEL`   | `info`                             | Log level: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` |
| `LOG_FORMAT`  | `pino-pretty` (dev) / `ecs` (prod) | Log output format                                                                   |
| `LOG_ENABLED` | `true` (non-test)                  | Enable or disable logging                                                           |
| `HTTP_PROXY`  | _(none)_                           | HTTP proxy URL                                                                      |
| `HTTPS_PROXY` | _(none)_                           | HTTPS proxy URL                                                                     |
