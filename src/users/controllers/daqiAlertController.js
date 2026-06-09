import { randomUUID } from 'node:crypto'
import { fetchDaqiAlerts } from '../utils/ricardoApiClient.js'
import { formatPollutantName } from '../utils/pollutantAlertProcessor.js'
import { mapUpstreamError } from '../utils/upstreamErrorMapper.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { STATUS_OK } from '../utils/constants.js'

const logger = createLogger()
const LOG_PREFIX = '[DAQIAlert]'
const SERVICE_NAME = 'DAQI alert service'
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

export async function daqiAlertHandler(request, h) {
  const requestId = request.headers['x-request-id'] || `req-${randomUUID()}`

  // Always query Ricardo for yesterday + today (UK local date). The
  // isWithinLast24Hours filter below then trims to the precise rolling window.
  const now = new Date()
  const endDate = UK_DATE_FORMATTER.format(now)
  const startDate = UK_DATE_FORMATTER.format(
    new Date(now.getTime() - TWENTY_FOUR_HOURS_MS)
  )

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

  const matchingAlerts = members.filter(
    (alert) =>
      typeof alert.daqi === 'number' &&
      alert.daqi >= daqiThreshold &&
      alert.validationStatus === 2 &&
      isWithinLast24Hours(alert.date)
  )

  logger.info(
    `${LOG_PREFIX} ${matchingAlerts.length} DAQI alert(s) passed filter (daqi>=${daqiThreshold}, validationStatus=2, within 24h) ${JSON.stringify({ requestId })}`
  )

  return h
    .response(sortByDateDesc(matchingAlerts).map(buildDaqiEntry))
    .code(STATUS_OK)
}
