import { fetchForecast } from './forecastApiClient.js'
import { sendNotification } from './notifyServiceClient.js'
import { findRegion } from './regionFinder.js'
import { maskPhoneNumber, maskEmail } from './maskingUtils.js'
import { formatLocationForUrl } from './locationUtils.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { DB_ERROR_CODE } from './constants.js'

const logger = createLogger()

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if the ISO timestamp string belongs to today (UTC date comparison).
 */
function isCurrentDate(updatedStr) {
  const today = new Date().toISOString().slice(0, 10)
  return typeof updatedStr === 'string' && updatedStr.startsWith(today)
}

/**
 * Resolves the UK region for every forecast entry using its lat/long coordinates.
 * Coordinates array is [lat, long] as supplied by the MetOffice API.
 */
function addRegionsToForecasts(forecasts) {
  return forecasts.map((item) => {
    const [lat, long] = item.location.coordinates
    const region = findRegion(lat, long)
    return { ...item, region }
  })
}

/**
 * Keeps only those forecasts whose TODAY value (first element in the forecast
 * array) is >= the configured DAQI threshold.
 */
function filterHighDaqiForecasts(forecastsWithRegions, threshold) {
  return forecastsWithRegions.filter((item) => {
    const todayValue = item.forecast?.[0]?.value ?? null
    return todayValue !== null && todayValue >= threshold
  })
}

/**
 * Returns one entry per unique region that has at least one station with a
 * breached DAQI value.  Entries with region 'Unknown' are skipped.
 * @returns {Array<{ region: string }>}
 */
function groupAlertsByRegion(alertIdentifiedArray) {
  const seen = new Set()
  for (const item of alertIdentifiedArray) {
    const { region } = item
    if (region !== 'Unknown') {
      seen.add(region)
    }
  }
  return Array.from(seen).map((region) => ({ region }))
}

/**
 * Any breach (DAQI >= 7) is classified as "high".
 */
function getDaqiLabel() {
  return 'high'
}

/**
 * Returns today's date formatted for SMS: e.g. "Fri 04 Apr"
 */
function formatTodayShort() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short'
  })
}

/**
 * Returns today's date formatted for email: e.g. "Friday 04 April"
 */
function formatTodayLong() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  })
}

/**
 * Resolves the correct Notify template ID for the given alert type and language.
 */
function getTemplateId(alertType, lang) {
  const isWelsh = lang === 'cy'
  if (alertType === 'sms') {
    return isWelsh
      ? config.get('forecastAlertTemplates.smsAlertCy')
      : config.get('forecastAlertTemplates.smsAlert')
  }
  return isWelsh
    ? config.get('forecastAlertTemplates.emailAlertCy')
    : config.get('forecastAlertTemplates.emailAlert')
}

// ── MongoDB helpers ───────────────────────────────────────────────────────────

async function isTodayScheduleComplete(db, forecastDate) {
  const state = await db
    .collection('forecast-schedule-state')
    .findOne({ forecastDate })
  return state?.status === 'completed'
}

async function markScheduleComplete(db, forecastDate) {
  await db.collection('forecast-schedule-state').updateOne(
    { forecastDate },
    {
      $set: {
        forecastDate,
        status: 'completed',
        completedAt: new Date()
      }
    },
    { upsert: true }
  )
}

// ── Audit entry helpers ───────────────────────────────────────────────────────

/**
 * Builds the flat list of per-user-location audit records from the region alert
 * summary.  Returns entries that include `lang` (used for template selection)
 * though `lang` is also persisted to aid debugging.
 *
 * @param {Array} users  - raw USERS documents
 * @param {Array} regionAlerts  - [{ region }]
 * @param {string} forecastDate - 'YYYY-MM-DD'
 * @returns {Array} audit entry objects
 */
function buildAuditEntries(users, regionAlerts, forecastDate) {
  const entries = []
  for (const { region } of regionAlerts) {
    for (const user of users) {
      const matchingLocations = (user.locations || []).filter(
        (loc) => loc.region === region
      )
      for (const loc of matchingLocations) {
        entries.push({
          forecastDate,
          user_contact: user.user_contact,
          alertType: user.alertType,
          lang: user.lang || 'en',
          location: loc.location,
          region,
          'forecast-alert-status': 'not-processed',
          notificationId: null,
          timestamp: new Date()
        })
      }
    }
  }
  return entries
}

/**
 * Inserts audit entries into the `metoffice-forecast-audit` collection.
 * Skips duplicates silently (unique index on forecastDate + user_contact +
 * location + region) — no retry or resume logic is applied.
 */
async function insertAuditEntries(db, entries) {
  for (const entry of entries) {
    try {
      await db.collection('metoffice-forecast-audit').insertOne(entry)
    } catch (err) {
      if (err.code === DB_ERROR_CODE) {
        logger.warn(
          `[Forecast] Duplicate audit entry skipped ${JSON.stringify({ forecastDate: entry.forecastDate, user_contact: entry.user_contact, location: entry.location, region: entry.region })}`
        )
      } else {
        throw err
      }
    }
  }
}

// ── Notification dispatch ─────────────────────────────────────────────────────

/**
 * Sends a forecast alert notification for each audit entry and updates the
 * entry's status in MongoDB.
 */
async function sendForecastAlertsToUsers(db, auditEntries) {
  for (const entry of auditEntries) {
    try {
      const lang = entry.lang || 'en'
      const templateId = getTemplateId(entry.alertType, lang)
      const locationSlug = formatLocationForUrl(entry.location)
      const checkAirQualityBaseUrl = config.get(
        'alertTemplates.checkAirQualityLink'
      )
      const checkAirQualityLink = `${checkAirQualityBaseUrl}${locationSlug}?lang=${lang}`

      const payload = {
        templateId,
        personalisation: {
          location: entry.location,
          daqi: getDaqiLabel(),
          today:
            entry.alertType === 'sms' ? formatTodayShort() : formatTodayLong(),
          checkAirQualityLink
        }
      }

      if (entry.alertType === 'sms') {
        payload.phoneNumber = entry.user_contact
      } else {
        payload.emailAddress = entry.user_contact
        const unsubscribeBaseUrl = config.get(
          'notification.templates.unsubscribeEmailLink'
        )
        payload.personalisation.unsubscribeLink = `${unsubscribeBaseUrl}?email=${encodeURIComponent(entry.user_contact)}`
      }

      const maskedContact =
        entry.alertType === 'sms'
          ? maskPhoneNumber(entry.user_contact)
          : maskEmail(entry.user_contact)
      const requestId = `forecast-${entry.region}-${maskedContact}-${Date.now()}`
      const responseBody = await sendNotification(payload, requestId)
      const notificationId = responseBody?.notificationId ?? null

      await db.collection('metoffice-forecast-audit').updateOne(
        {
          forecastDate: entry.forecastDate,
          user_contact: entry.user_contact,
          location: entry.location,
          region: entry.region,
          'forecast-alert-status': 'not-processed'
        },
        {
          $set: {
            'forecast-alert-status': 'processed',
            notificationId
          }
        }
      )

      logger.info(
        `[Forecast] Forecast alert sent ${JSON.stringify({
          region: entry.region,
          alertType: entry.alertType,
          location: entry.location,
          notificationId
        })}`
      )
    } catch (err) {
      logger.error(
        `[Forecast] Failed to send forecast alert ${JSON.stringify({
          region: entry.region,
          alertType: entry.alertType,
          location: entry.location,
          error: err.message
        })}`
      )
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Runs the MetOffice DAQI forecast alert cycle once.
 * Called by the scheduler hourly within the daily window — the first tick with
 * current forecast data does the work; subsequent ticks short-circuit via
 * the forecast-schedule-state guard.
 */
export async function processForecastAlerts(db) {
  logger.info('[Forecast] Starting MetOffice forecast alert processing cycle')

  const forecastDate = new Date().toISOString().slice(0, 10)

  // ── Already completed today? ──────────────────────────────────────────────
  if (await isTodayScheduleComplete(db, forecastDate)) {
    logger.info(
      '[Forecast] MetOffice forecast alerts already completed for today, skipping'
    )
    return
  }

  // ── Step 1: fetch forecast data ───────────────────────────────────────────
  let forecastData
  try {
    forecastData = await fetchForecast()
  } catch (err) {
    logger.error(
      `[Forecast] Failed to fetch forecast data ${JSON.stringify({ error: err.message })}`
    )
    return
  }

  const forecasts = forecastData.forecasts || []
  if (forecasts.length === 0) {
    logger.info('[Forecast] No forecast data returned from forecast API')
    return
  }

  // ── Step 2: check whether data has been updated for today ─────────────────
  const hasCurrentData = forecasts.some((f) => isCurrentDate(f.updated))
  if (!hasCurrentData) {
    logger.info('[Forecast] MetOffice forecast data not available for the day')
    return
  }

  logger.info(
    `[Forecast] Current forecast data confirmed. Processing ${forecasts.length} monitoring stations`
  )

  // ── Step 3: resolve UK region for every monitoring station ────────────────
  const forecastsWithRegions = addRegionsToForecasts(forecasts)

  // ── Step 4: filter stations with today DAQI >= threshold ─────────────────
  const threshold = config.get('metOfficeForecast.daqiAlertThreshold')
  const alertIdentifiedArray = filterHighDaqiForecasts(
    forecastsWithRegions,
    threshold
  )

  logger.info(
    `[Forecast] ${alertIdentifiedArray.length} stations with DAQI >= ${threshold} identified`
  )

  if (alertIdentifiedArray.length === 0) {
    logger.info('[Forecast] No high DAQI forecasts today : no alerts to send')
    await markScheduleComplete(db, forecastDate)
    return
  }

  // ── Step 5: group by region, fetch registered users ───────────────────────
  const regionAlerts = groupAlertsByRegion(alertIdentifiedArray)
  const alertRegions = regionAlerts.map((r) => r.region)

  logger.info(`[Forecast] Alert regions identified: ${alertRegions.join(', ')}`)

  const users = await db
    .collection('USERS')
    .find({ 'locations.region': { $in: alertRegions } })
    .toArray()

  logger.info(`[Forecast] ${users.length} users found in alert regions`)

  const auditEntries = buildAuditEntries(users, regionAlerts, forecastDate)
  logger.info(`[Forecast] ${auditEntries.length} user-location pairs to notify`)

  await insertAuditEntries(db, auditEntries)

  // ── Step 6: send notifications and update audit ───────────────────────────
  await sendForecastAlertsToUsers(db, auditEntries)

  await markScheduleComplete(db, forecastDate)
  logger.info('[Forecast] MetOffice forecast alert processing cycle completed')
}

export {
  isCurrentDate,
  addRegionsToForecasts,
  filterHighDaqiForecasts,
  groupAlertsByRegion,
  getDaqiLabel,
  buildAuditEntries
}
