import { randomUUID } from 'node:crypto'
import Boom from '@hapi/boom'
import { fetchAlerts } from '../utils/ricardoApiClient.js'
import { findRegion } from '../utils/regionFinder.js'
import {
  getSiteIdsForRegion,
  getSiteInfo
} from '../utils/ricardoSiteAndRegionCache.js'
import { formatPollutantName } from '../utils/pollutantAlertProcessor.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { STATUS_OK } from '../utils/constants.js'

const logger = createLogger()
const LOG_PREFIX = '[AQSRAlert]'
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

// en-CA locale formats as YYYY-MM-DD; timeZone pins it to UK local date
// regardless of host timezone, so BST/GMT shifts are handled correctly.
const UK_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

function isWithinLast24Hours(dateString) {
  const alertDate = new Date(dateString)
  if (!Number.isFinite(alertDate.getTime())) {
    return false
  }
  const ageMs = Date.now() - alertDate.getTime()
  return ageMs >= 0 && ageMs <= TWENTY_FOUR_HOURS_MS
}

function buildAlertEntry(alert) {
  const siteInfo = getSiteInfo(alert.siteId)
  return {
    'active-breaches': isWithinLast24Hours(alert.date),
    'pollutant-name': formatPollutantName(alert.pollutant),
    'monitoring-station-name': siteInfo?.monitoringStationName ?? null,
    region: siteInfo?.region ?? null,
    'alert-started': alert.date
  }
}

function isBreachConfirmed(alert) {
  return alert.alertLevel === true || alert.informationLevel === true
}

async function fetchRicardoAlerts(requestId, options = {}) {
  try {
    return await fetchAlerts(options)
  } catch (err) {
    logger.error(
      `${LOG_PREFIX} Ricardo API call failed ${JSON.stringify({ requestId, upstreamStatus: err.status ?? null, error: err.message })}`
    )
    return null
  }
}

// Mode 1: location-scoped — filters by region derived from lat/long, siteId match, within 24h
async function handleCurrentDayMode(request, h) {
  const requestId = request.headers['x-request-id'] || `req-${randomUUID()}`
  const { lat, long } = request.query

  const region = findRegion(lat, long)
  logger.info(
    `${LOG_PREFIX} Region resolved ${JSON.stringify({ requestId, lat, long, region })}`
  )

  if (region === 'Unknown') {
    logger.info(
      `${LOG_PREFIX} Coordinates outside known UK regions ${JSON.stringify({ requestId, lat, long })}`
    )
    return h.response([]).code(STATUS_OK)
  }

  const regionSiteIds = new Set(getSiteIdsForRegion(region))
  logger.info(
    `${LOG_PREFIX} Site IDs found for region ${JSON.stringify({ requestId, region, count: regionSiteIds.size })}`
  )

  if (regionSiteIds.size === 0) {
    logger.info(
      `${LOG_PREFIX} No sites in cache for region "${region}" ${JSON.stringify({ requestId })}`
    )
    return h.response([]).code(STATUS_OK)
  }

  // Narrow the Ricardo query to yesterday + today (UK local date) so the
  // response stays small; the isWithinLast24Hours filter below then trims it
  // to the precise window.
  const now = new Date()
  const endDate = UK_DATE_FORMATTER.format(now)
  const startDate = UK_DATE_FORMATTER.format(
    new Date(now.getTime() - TWENTY_FOUR_HOURS_MS)
  )
  const alertData = await fetchRicardoAlerts(requestId, { startDate, endDate })
  if (!alertData) {
    return Boom.badGateway('Air quality alert service temporarily unavailable')
  }

  const members = alertData.member ?? []
  logger.info(
    `${LOG_PREFIX} Received ${members.length} alert(s) from Ricardo ${JSON.stringify({ requestId })}`
  )

  const activeAlerts = members.filter(
    (alert) =>
      isWithinLast24Hours(alert.date) &&
      regionSiteIds.has(alert.siteId) &&
      isBreachConfirmed(alert)
  )

  logger.info(
    `${LOG_PREFIX} current-day mode: ${activeAlerts.length} active alert(s) within 24h for region "${region}" ${JSON.stringify({ requestId })}`
  )

  return h.response(activeAlerts.map(buildAlertEntry)).code(STATUS_OK)
}

// Mode 2: global — no location filter, returns all breach records from Ricardo for the period
async function handleDateRangeMode(request, h) {
  const requestId = request.headers['x-request-id'] || `req-${randomUUID()}`
  const { startDate, endDate } = request.query

  const alertData = await fetchRicardoAlerts(requestId, { startDate, endDate })
  if (!alertData) {
    return Boom.badGateway('Air quality alert service temporarily unavailable')
  }

  const members = alertData.member ?? []
  logger.info(
    `${LOG_PREFIX} Received ${members.length} alert(s) from Ricardo ${JSON.stringify({ requestId, startDate, endDate })}`
  )

  const breachAlerts = members.filter(isBreachConfirmed)
  logger.info(
    `${LOG_PREFIX} date-range mode: ${breachAlerts.length} breach alert(s) for period ${JSON.stringify({ requestId, startDate, endDate })}`
  )

  return h.response(breachAlerts.map(buildAlertEntry)).code(STATUS_OK)
}

export async function aqsrAlertHandler(request, h) {
  const { currentDay } = request.query
  return currentDay
    ? handleCurrentDayMode(request, h)
    : handleDateRangeMode(request, h)
}
