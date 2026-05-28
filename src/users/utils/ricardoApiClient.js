import { fetch, Agent, ProxyAgent } from 'undici'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { provideProxy } from '../../common/helpers/proxy/proxy.js'

const logger = createLogger()
const isProduction = process.env.NODE_ENV === 'production'
const RICARDO_REQUEST_TIMEOUT_MS = 30_000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

// en-CA locale formats as YYYY-MM-DD; timeZone pins it to UK local date
// regardless of host timezone, so BST/GMT shifts are handled correctly.
const UK_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

// ---------------------------------------------------------------------------
// Mock alert data — used when RICARDO_API_USE_MOCK=true.
// Only fetchAlerts is mocked. getAccessToken and fetchSiteMetaData always call
// the real Ricardo API so the site-region cache is populated with live data.
// Note: query params (start-date / end-date) are ignored — all 18 alerts are
// returned every call. For date-filter behaviour, run against the real API.
// ---------------------------------------------------------------------------

const MOCK_ALERTS_RESPONSE = {
  '@context': '/api/contexts/AQSRAlert',
  '@id': '/api/aqsr_alerts',
  '@type': 'Collection',
  totalItems: 1,
  member: [
    {
      '@id': '/api/a_q_s_r_alerts/1187',
      '@type': 'AQSRAlert',
      id: 1187,
      samplingPointId: 1111,
      siteId: 'UKA00128',
      region: 'East Central Scotland',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold:
        'EU ozone public information threshold of 180&micro;g/m<sup>3</sup>',
      informationLevel: true,
      alertThreshold: 'Ozone Alert 240&micro;g/m<sup>3</sup>',
      alertLevel: true,
      concentration: 190,
      duration: null,
      alertText:
        '<?xml encoding="utf-8" ?><h3>Pollution Alert Warning Wed 13/08/2025 at 5pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Salford Ec[...]',
      coverage: 'N/A',
      validationStatus: 2,
      date: '2026-05-26T05:00:00+01:00'
    }
  ]
}

/**
 * Builds an undici dispatcher for Ricardo API calls.
 *
 * The Ricardo staging server uses an untrusted TLS certificate, so
 * rejectUnauthorized is disabled for non-production environments.
 * In production, standard SSL verification applies.
 * Proxy configuration from provideProxy() is respected in all environments.
 */
function getRicardoDispatcher() {
  const proxy = provideProxy()

  if (!isProduction) {
    const connectOptions = { rejectUnauthorized: false }
    if (proxy) {
      return new ProxyAgent({
        uri: proxy.url.toString(),
        connect: connectOptions,
        keepAliveTimeout: 10,
        keepAliveMaxTimeout: 10
      })
    }
    return new Agent({ connect: connectOptions })
  }

  return proxy ? proxy.proxyAgent : undefined
}

async function ensureRicardoResponseOk(response, operation) {
  if (response.ok) {
    return
  }

  const errorText = await response.text()
  logger.error(
    `Ricardo API call failed ${JSON.stringify({ operation, status: response.status, errorText })}`
  )
  const err = new Error(
    `Ricardo API ${operation} failed: ${response.status} - ${errorText}`
  )
  err.status = response.status
  err.body = errorText
  throw err
}

export async function getAccessToken() {
  const loginUrl = config.get('ricardoApi.loginUrl')
  const email = config.get('ricardoApi.email')
  const password = config.get('ricardoApi.password')

  logger.info('Requesting access token from Ricardo API')

  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(RICARDO_REQUEST_TIMEOUT_MS)
  }
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher
  }

  const response = await fetch(loginUrl, fetchOptions)
  await ensureRicardoResponseOk(response, 'login')

  const data = await response.json()
  const token = data.token
  if (!token) {
    logger.error(
      `Ricardo API login succeeded but no token found in response. Available keys: ${Object.keys(data).join(', ')}`
    )
    throw new Error(
      'Ricardo API login succeeded but no token field found in response'
    )
  }

  logger.info('Ricardo API access token obtained successfully')
  return token
}

async function fetchAlertsFromRicardo(options = {}) {
  const token = await getAccessToken()
  const baseAlertsUrl = config.get('ricardoApi.alertsUrl')
  // Default to a rolling 24-hour window (yesterday → today, UK local date)
  // when the caller doesn't supply explicit dates, so the pollutant scheduler
  // only ever sees alerts relevant to its 30-minute cycle.
  const now = new Date()
  const startDate =
    options.startDate ||
    UK_DATE_FORMATTER.format(new Date(now.getTime() - TWENTY_FOUR_HOURS_MS))
  const endDate = options.endDate || UK_DATE_FORMATTER.format(now)
  const alertsUrl = `${baseAlertsUrl}?start-date=${startDate}&end-date=${endDate}`

  logger.info(
    `Fetching AQSR alerts from Ricardo API ${JSON.stringify({ url: alertsUrl })}`
  )

  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/ld+json',
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(RICARDO_REQUEST_TIMEOUT_MS)
  }
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher
  }

  const response = await fetch(alertsUrl, fetchOptions)
  await ensureRicardoResponseOk(response, 'alerts fetch')

  const data = await response.json()
  logger.info(`Fetched ${data.totalItems} alerts from Ricardo API`)
  return data
}

// When useMock=true, the real Ricardo API is still called so live traffic
// is generated against it (for perf measurement); the mock response is then
// returned to the caller so downstream logic has deterministic data to work
// with. When useMock=false, the real Ricardo response is returned directly.
export async function fetchAlerts(options = {}) {
  if (config.get('ricardoApi.useMock')) {
    try {
      const realData = await fetchAlertsFromRicardo(options)
      logger.info(
        `[PERF-TEST] Real Ricardo call succeeded with ${realData.totalItems} items; returning mock response instead`
      )
    } catch (err) {
      logger.warn(
        `[PERF-TEST] Real Ricardo call failed during mock mode (continuing with mock) ${JSON.stringify({ error: err.message })}`
      )
    }
    logger.info(
      `[MOCK] Returning mock Ricardo alerts response (${MOCK_ALERTS_RESPONSE.totalItems} items)`
    )
    return MOCK_ALERTS_RESPONSE
  }

  return fetchAlertsFromRicardo(options)
}

export async function fetchSiteMetaData() {
  const token = await getAccessToken()
  const siteMetaDataUrl = config.get('ricardoApi.siteMetaDataUrl')

  logger.info(
    `Fetching site metadata from Ricardo API ${JSON.stringify({ url: siteMetaDataUrl })}`
  )

  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/ld+json',
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(RICARDO_REQUEST_TIMEOUT_MS)
  }
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher
  }

  const response = await fetch(siteMetaDataUrl, fetchOptions)
  await ensureRicardoResponseOk(response, 'site metadata fetch')

  const data = await response.json()
  logger.info(`Fetched ${data.totalItems} sites from Ricardo API`)
  return data
}
