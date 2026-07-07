import { randomUUID } from 'node:crypto'
import { fetchDaqiAlerts } from '../utils/ricardoApiClient.js'
import { getRegionForSite } from '../utils/ricardoSiteAndRegionCache.js'
import { resolveRegionContext } from '../utils/regionResolver.js'
import { formatPollutantName } from '../utils/pollutantAlertProcessor.js'
import { mapUpstreamError } from '../utils/upstreamErrorMapper.js'
import {
  isWithinLast24Hours,
  getRollingDayWindow
} from '../utils/dateRangeUtils.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { STATUS_OK } from '../utils/constants.js'

const logger = createLogger()
const LOG_PREFIX = '[DAQIAlert]'
const SERVICE_NAME = 'DAQI alert service'

function buildDaqiEntry(alert) {
  return {
    'active-breaches': true,
    'pollutant-name': formatPollutantName(alert.pollutant),
    daqi: alert.daqi,
    samplingPointId: alert.samplingPointId ?? null,
    siteId: alert.siteId ?? null,
    'alert-started': alert.date
  }
}

// Lock response order to newest-first regardless of Ricardo's sort behaviour,
// so the front-end can rely on "latest at the top of the results page".
function sortByDateDesc(alerts) {
  return alerts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )
}

// Dedup rules per samplingPointId (unique per siteId+pollutant):
//   - same timestamp → keep highest daqi
//   - different timestamp → keep latest timestamp
function deduplicateAlerts(alerts) {
  const best = new Map()
  for (const alert of alerts) {
    const key = alert.samplingPointId
    const existing = best.get(key)
    if (!existing) {
      best.set(key, alert)
      continue
    }
    const incomingTime = new Date(alert.date).getTime()
    const existingTime = new Date(existing.date).getTime()
    if (
      incomingTime > existingTime ||
      (incomingTime === existingTime && alert.daqi > existing.daqi)
    ) {
      best.set(key, alert)
    }
  }
  return [...best.values()]
}

export async function daqiAlertHandler(request, h) {
  const requestId = request.headers['x-request-id'] || `req-${randomUUID()}`
  const { lat, long } = request.query

  // Resolve the UK region from the supplied coordinates and ensure the site
  // cache is healthy. Each alert's region is then looked up per-siteId from the
  // cache during filtering below (region is always derived from siteId, never
  // from Ricardo's coarse region field).
  const context = await resolveRegionContext(lat, long, {
    logPrefix: LOG_PREFIX,
    requestId
  })
  if (!context) {
    return h.response([]).code(STATUS_OK)
  }
  const { region } = context

  // Always query Ricardo for yesterday + today (UK local date). The
  // isWithinLast24Hours filter below then trims to the precise rolling window.
  const { startDate, endDate } = getRollingDayWindow()

  logger.info(
    `${LOG_PREFIX} Handler started ${JSON.stringify({ requestId, startDate, endDate })}`
  )

  let alertData
  try {
    alertData = await fetchDaqiAlerts({ startDate, endDate })
  } catch (err) {
    logger.error(
      `${LOG_PREFIX} Ricardo DAQI call failed ${JSON.stringify({ requestId, upstreamStatus: err?.status ?? null, error: err.message })}`
    )
    return mapUpstreamError(err, SERVICE_NAME)
  }

  const members = alertData.member ?? []
  logger.info(
    `${LOG_PREFIX} Received ${members.length} DAQI alert(s) from Ricardo ${JSON.stringify({ requestId })}`
  )

  if (members.length === 0) {
    return h.response([]).code(STATUS_OK)
  }

  const daqiThreshold = config.get('metOfficeForecast.daqiAlertThreshold')

  // For each alert, resolve its region from siteId via the cache and keep it
  // only if that region matches the caller's region.
  const matchingAlerts = members.filter(
    (alert) =>
      typeof alert.daqi === 'number' &&
      alert.daqi >= daqiThreshold &&
      alert.validationStatus === 2 &&
      isWithinLast24Hours(alert.date) &&
      getRegionForSite(alert.siteId) === region
  )

  logger.info(
    `${LOG_PREFIX} ${matchingAlerts.length} DAQI alert(s) passed filter (daqi>=${daqiThreshold}, validationStatus=2, region="${region}", within 24h) ${JSON.stringify({ requestId })}`
  )

  const dedupedAlerts = deduplicateAlerts(matchingAlerts)
  logger.info(
    `${LOG_PREFIX} ${dedupedAlerts.length} DAQI alert(s) after dedup (${matchingAlerts.length - dedupedAlerts.length} collapsed) ${JSON.stringify({ requestId })}`
  )

  return h
    .response(sortByDateDesc(dedupedAlerts).map(buildDaqiEntry))
    .code(STATUS_OK)
}
