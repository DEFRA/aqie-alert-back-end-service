import { fetch, Agent, ProxyAgent } from 'undici'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { provideProxy } from '../../common/helpers/proxy/proxy.js'

const logger = createLogger()
const isProduction = process.env.NODE_ENV === 'production'
const RICARDO_REQUEST_TIMEOUT_MS = 30_000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const ACCEPT_LD_JSON = 'application/ld+json'
const CONTENT_TYPE_JSON = 'application/json'
// Cap how much of an upstream error body we log (large HTML proxy/block pages
// would otherwise flood the logs on every failed call).
const ERROR_BODY_LOG_LIMIT = 200

// en-CA locale formats as YYYY-MM-DD; timeZone pins it to UK local date
// regardless of host timezone, so BST/GMT shifts are handled correctly.
const UK_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

// ---------------------------------------------------------------------------
// WireMock AQSR stub — used when RICARDO_API_USE_MOCK=true.
// Calls the WireMock Cloud stub instead of the real Ricardo AQSR API.
// ---------------------------------------------------------------------------
const WIREMOCK_AQSR_URL = config.get('ricardoApi.aqsrMockUrl')

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
  // Upstream errors can return large HTML bodies (e.g. a proxy/Zscaler block
  // page). Log only a short snippet and keep it OUT of err.message, so the many
  // downstream catches that log err.message don't each re-dump kilobytes of
  // HTML into CDP logs. The full body stays on err.body for callers that need it.
  const errorSnippet = errorText.slice(0, ERROR_BODY_LOG_LIMIT)
  logger.error(
    `Ricardo API call failed ${JSON.stringify({ operation, status: response.status, errorSnippet })}`
  )
  const err = new Error(`Ricardo API ${operation} failed: ${response.status}`)
  err.status = response.status
  err.body = errorText
  throw err
}

/**
 * Performs an authenticated GET against the Ricardo API.
 * Handles token retrieval, dispatcher setup, headers, timeout, error
 * normalisation and JSON parsing — leaving callers to only construct the URL
 * and surface the entity-specific success log.
 */
async function authenticatedRicardoGet(url, operation) {
  const token = await getAccessToken()
  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'GET',
    headers: {
      'Content-Type': CONTENT_TYPE_JSON,
      Accept: ACCEPT_LD_JSON,
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(RICARDO_REQUEST_TIMEOUT_MS)
  }
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher
  }

  const response = await fetch(url, fetchOptions)
  await ensureRicardoResponseOk(response, operation)
  return response.json()
}

export async function getAccessToken() {
  const loginUrl = config.get('ricardoApi.loginUrl')
  const email = config.get('ricardoApi.email')
  const password = config.get('ricardoApi.password')

  logger.info('Requesting access token from Ricardo API')

  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': CONTENT_TYPE_JSON },
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

async function fetchAqsrFromWireMock() {
  logger.info(
    `[MOCK] Fetching AQSR alerts from WireMock ${JSON.stringify({ url: WIREMOCK_AQSR_URL })}`
  )
  const response = await fetch(WIREMOCK_AQSR_URL, {
    signal: AbortSignal.timeout(RICARDO_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`WireMock AQSR stub returned ${response.status}`)
  }
  return response.json()
}

async function fetchAlertsFromRicardo(options = {}) {
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

  const data = await authenticatedRicardoGet(alertsUrl, 'alerts fetch')
  logger.info(`Fetched ${data.totalItems} alerts from Ricardo API`)
  return data
}

export async function fetchAlerts(options = {}) {
  if (config.get('ricardoApi.useMock')) {
    return fetchAqsrFromWireMock()
  }
  return fetchAlertsFromRicardo(options)
}

// ---------------------------------------------------------------------------
// WireMock DAQI stub — used when RICARDO_API_USE_MOCK=true.
// Calls the WireMock Cloud stub instead of the real Ricardo DAQI API.
// ---------------------------------------------------------------------------
const WIREMOCK_DAQI_URL = config.get('ricardoApi.daqiMockUrl')

async function fetchDaqiFromWireMock() {
  logger.info(
    `[MOCK] Fetching DAQI alerts from WireMock ${JSON.stringify({ url: WIREMOCK_DAQI_URL })}`
  )
  const response = await fetch(WIREMOCK_DAQI_URL, {
    signal: AbortSignal.timeout(RICARDO_REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`WireMock DAQI stub returned ${response.status}`)
  }
  return response.json()
}

async function fetchDaqiAlertsFromRicardo(options = {}) {
  const baseDaqiUrl = config.get('ricardoApi.daqiAlertsUrl')
  const { startDate, endDate } = options
  const daqiUrl =
    startDate && endDate
      ? `${baseDaqiUrl}?start-date=${startDate}&end-date=${endDate}`
      : `${baseDaqiUrl}`

  logger.info(
    `Fetching DAQI alerts from Ricardo API ${JSON.stringify({ url: daqiUrl })}`
  )

  const data = await authenticatedRicardoGet(daqiUrl, 'daqi alerts fetch')
  logger.info(`Fetched ${data.totalItems} DAQI alerts from Ricardo API`)
  return data
}

export async function fetchDaqiAlerts(options = {}) {
  if (config.get('ricardoApi.useMock')) {
    return fetchDaqiFromWireMock()
  }
  return fetchDaqiAlertsFromRicardo(options)
}

export async function fetchSiteMetaData() {
  const siteMetaDataUrl = config.get('ricardoApi.siteMetaDataUrl')

  logger.info(
    `Fetching site metadata from Ricardo API ${JSON.stringify({ url: siteMetaDataUrl })}`
  )

  const data = await authenticatedRicardoGet(
    siteMetaDataUrl,
    'site metadata fetch'
  )
  logger.info(`Fetched ${data.totalItems} sites from Ricardo API`)
  return data
}
