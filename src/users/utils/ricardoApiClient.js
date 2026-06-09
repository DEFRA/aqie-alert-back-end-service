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
// Note: query params (start-date / end-date) are ignored — all alerts are
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

/**
 * Wraps a Ricardo fetch with mock-fallback behaviour. When
 * ricardoApi.useMock=true, the real upstream is still called so live traffic
 * is generated (useful for perf testing and for verifying credentials remain
 * valid), then the mock response is returned to the caller so downstream
 * logic has deterministic data. When useMock=false, the real response is
 * returned directly.
 */
async function fetchWithMockFallback(realFetch, options, mockBuilder, label) {
  if (!config.get('ricardoApi.useMock')) {
    return realFetch(options)
  }

  try {
    const realData = await realFetch(options)
    logger.info(
      `[MOCK] Real Ricardo ${label} call succeeded with ${realData.totalItems} items; returning mock response instead`
    )
  } catch (err) {
    logger.warn(
      `[MOCK] Real Ricardo ${label} call failed during mock mode (continuing with mock) ${JSON.stringify({ error: err.message })}`
    )
  }

  const mockResponse = mockBuilder()
  logger.info(
    `[MOCK] Returning mock Ricardo ${label} response (${mockResponse.totalItems} items)`
  )
  return mockResponse
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
  return fetchWithMockFallback(
    fetchAlertsFromRicardo,
    options,
    () => MOCK_ALERTS_RESPONSE,
    'alerts'
  )
}

// ---------------------------------------------------------------------------
// Mock DAQI alert data — used when RICARDO_API_USE_MOCK=true.
// Live DAQI breaches are rare in staging, so a stable mock keeps the
// front-end /daqi-alert page populated for hook-up and visual testing.
// Dates are regenerated on every call so they always fall inside the
// rolling 24-hour window (the controller's within-24h filter would otherwise
// trim them out if the server has been running for more than a day).
// ---------------------------------------------------------------------------
function buildMockDaqiResponse() {
  const now = Date.now()
  const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString()
  const older = new Date(now - 8 * 60 * 60 * 1000).toISOString()

  return {
    '@context': '/api/contexts/DAQIAlert',
    '@id': '/api/daqi_alerts',
    '@type': 'Collection',
    totalItems: 3,
    member: [
      {
        '@id': '/api/d_a_q_i_alerts/7716220260528',
        '@type': 'DAQIAlert',
        id: 7716220260528,
        samplingPointId: 77162,
        siteId: 'UKA00819',
        region: 'Wales',
        daqi: 7,
        level: 'High',
        pollutant: 'O<sub>3</sub> (O3)',
        validationStatus: 2,
        date: recent
      },
      {
        '@id': '/api/d_a_q_i_alerts/7716220260529',
        '@type': 'DAQIAlert',
        id: 7716220260529,
        samplingPointId: 12401,
        siteId: 'UKA00524',
        region: 'Yorkshire & Humber',
        daqi: 8,
        level: 'High',
        pollutant: 'NO<sub>2</sub> (NO2)',
        validationStatus: 2,
        date: older
      },
      {
        '@id': '/api/d_a_q_i_alerts/7716220260530',
        '@type': 'DAQIAlert',
        id: 7716220260530,
        samplingPointId: 1258,
        siteId: 'UKA00482',
        region: 'North West & Merseyside',
        daqi: 9,
        level: 'Very High',
        pollutant: 'SO<sub>2</sub> (SO2)',
        validationStatus: 2,
        date: recent
      }
    ]
  }
}

async function fetchDaqiAlertsFromRicardo(options = {}) {
  const baseDaqiUrl = config.get('ricardoApi.daqiAlertsUrl')
  const { startDate, endDate } = options
  const daqiUrl =
    startDate && endDate
      ? `${baseDaqiUrl}?page=1&start-date=${startDate}&end-date=${endDate}`
      : `${baseDaqiUrl}?page=1`

  logger.info(
    `Fetching DAQI alerts from Ricardo API ${JSON.stringify({ url: daqiUrl })}`
  )

  const data = await authenticatedRicardoGet(daqiUrl, 'daqi alerts fetch')
  logger.info(`Fetched ${data.totalItems} DAQI alerts from Ricardo API`)
  return data
}

export async function fetchDaqiAlerts(options = {}) {
  return fetchWithMockFallback(
    fetchDaqiAlertsFromRicardo,
    options,
    buildMockDaqiResponse,
    'DAQI alerts'
  )
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
