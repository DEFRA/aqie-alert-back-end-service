import { randomUUID } from 'node:crypto'
import { fetchAlerts } from '../utils/ricardoApiClient.js'
import {
  getSiteInfo,
  getRegionForSite
} from '../utils/ricardoSiteAndRegionCache.js'
import { resolveRegionContext } from '../utils/regionResolver.js'
import { formatPollutantName } from '../utils/pollutantAlertProcessor.js'
import { mapUpstreamError } from '../utils/upstreamErrorMapper.js'
import {
  isWithinLast24Hours,
  getRollingDayWindow
} from '../utils/dateRangeUtils.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { STATUS_OK } from '../utils/constants.js'
import { deduplicateAlerts } from '../utils/alertDedupUtils.js'

const logger = createLogger()
const LOG_PREFIX = '[AQSRAlert]'
const SERVICE_NAME = 'Air quality alert service'

function buildAlertEntry(alert) {
  const siteInfo = getSiteInfo(alert.siteId)
  return {
    'active-breaches': isWithinLast24Hours(alert.date),
    'sampling-id': alert.samplingPointId ?? null,
    'pollutant-name': formatPollutantName(alert.pollutant),
    concentration: alert.concentration ?? null,
    'monitoring-station-name': siteInfo?.monitoringStationName ?? null,
    region: siteInfo?.region ?? null,
    'alert-started': alert.date
  }
}

function isBreachConfirmed(alert) {
  return alert.alertLevel === true || alert.informationLevel === true
}

// Lock response order to newest-first regardless of Ricardo's sort behaviour,
// so the front-end can rely on "latest at the top of the results page".
function sortByDateDesc(alerts) {
  return alerts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )
}

// Dedup rules per samplingPointId (unique per siteId+pollutant):
//   - same timestamp → keep highest concentration
//   - different timestamp → keep latest timestamp
// Delegated to shared alertDedupUtils.

async function fetchRicardoAlerts(requestId, options = {}) {
  try {
    return await fetchAlerts(options)
  } catch (err) {
    logger.error(
      `${LOG_PREFIX} Ricardo API call failed ${JSON.stringify({ requestId, upstreamStatus: err.status ?? null, error: err.message })}`
    )
    throw err
  }
}

// Mode 1: location-scoped — filters by region derived from lat/long, siteId match, within 24h
async function handleCurrentDayMode(request, h) {
  const requestId = request.headers['x-request-id'] || `req-${randomUUID()}`
  const { lat, long } = request.query

  const context = await resolveRegionContext(lat, long, {
    logPrefix: LOG_PREFIX,
    requestId
  })
  if (!context) {
    return h.response([]).code(STATUS_OK)
  }
  const { region } = context

  // Narrow the Ricardo query to yesterday + today (UK local date) so the
  // response stays small; the isWithinLast24Hours filter below then trims it
  // to the precise window.
  const { startDate, endDate } = getRollingDayWindow()
  let alertData
  try {
    alertData = await fetchRicardoAlerts(requestId, { startDate, endDate })
  } catch (err) {
    return mapUpstreamError(err, SERVICE_NAME)
  }

  const members = alertData.member ?? []
  logger.info(
    `${LOG_PREFIX} Received ${members.length} alert(s) from Ricardo ${JSON.stringify({ requestId })}`
  )

  // For each alert, resolve its region from siteId via the cache and keep it
  // only if that region matches the caller's region. Track per-predicate
  // pass counts independently so the log surfaces *which* check rejected
  // the rows when activeAlerts ends up empty.
  let inWindow = 0
  let inRegion = 0
  let confirmed = 0
  const activeAlerts = members.filter((alert) => {
    const wasInWindow = isWithinLast24Hours(alert.date)
    const wasInRegion = getRegionForSite(alert.siteId) === region
    const wasConfirmed = isBreachConfirmed(alert)
    if (wasInWindow) {
      inWindow++
    }
    if (wasInRegion) {
      inRegion++
    }
    if (wasConfirmed) {
      confirmed++
    }
    return wasInWindow && wasInRegion && wasConfirmed
  })
  logger.info(
    `${LOG_PREFIX} current-day filter for region "${region}": ${JSON.stringify({
      requestId,
      ricardo: members.length,
      in_window: inWindow,
      in_region: inRegion,
      confirmed,
      active: activeAlerts.length
    })}`
  )

  const dedupedAlerts = deduplicateAlerts(activeAlerts, 'concentration')
  logger.info(
    `${LOG_PREFIX} ${dedupedAlerts.length} AQSR alert(s) after dedup (${activeAlerts.length - dedupedAlerts.length} collapsed) ${JSON.stringify({ requestId })}`
  )

  return h
    .response(sortByDateDesc(dedupedAlerts).map(buildAlertEntry))
    .code(STATUS_OK)
}

// Mode 2: global — no location filter, returns all breach records from Ricardo for the period
async function handleDateRangeMode(request, h) {
  const requestId = request.headers['x-request-id'] || `req-${randomUUID()}`
  const { startDate, endDate } = request.query

  let alertData
  try {
    alertData = await fetchRicardoAlerts(requestId, { startDate, endDate })
  } catch (err) {
    return mapUpstreamError(err, SERVICE_NAME)
  }

  const members = alertData.member ?? []
  logger.info(
    `${LOG_PREFIX} Received ${members.length} alert(s) from Ricardo ${JSON.stringify({ requestId, startDate, endDate })}`
  )

  const breachAlerts = members.filter(isBreachConfirmed)
  logger.info(
    `${LOG_PREFIX} date-range mode: ${breachAlerts.length} breach alert(s) for period ${JSON.stringify({ requestId, startDate, endDate })}`
  )

  return h
    .response(sortByDateDesc(breachAlerts).map(buildAlertEntry))
    .code(STATUS_OK)
}

export async function aqsrAlertHandler(request, h) {
  const { currentDay } = request.query
  return currentDay
    ? handleCurrentDayMode(request, h)
    : handleDateRangeMode(request, h)
}
