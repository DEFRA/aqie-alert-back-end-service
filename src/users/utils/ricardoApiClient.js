import { fetch, Agent, ProxyAgent } from 'undici'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { provideProxy } from '../../common/helpers/proxy/proxy.js'

const logger = createLogger()
const isProduction = process.env.NODE_ENV === 'production'
const RICARDO_REQUEST_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Mock alert data — used when RICARDO_API_USE_MOCK=true.
// Only fetchAlerts is mocked. getAccessToken and fetchSiteMetaData always call
// the real Ricardo API so the site-region cache is populated with live data.
// ---------------------------------------------------------------------------
const MOCK_ALERT_DATE_ACTIVE = new Date(
  Date.now() - 2 * 60 * 60 * 1000
).toISOString()
const MOCK_ALERT_DATE_PAST = new Date(
  Date.now() - 48 * 60 * 60 * 1000
).toISOString()

const MOCK_ALERTS_RESPONSE = {
  '@context': '/api/contexts/AQSRAlert',
  '@id': '/api/aqsr_alerts',
  '@type': 'Collection',
  totalItems: 18,
  member: [
    // --- ACTIVE breaches (within last 24h) ---
    {
      '@id': '/api/a_q_s_r_alerts/1187',
      '@type': 'AQSRAlert',
      id: 1187,
      samplingPointId: 1238,
      siteId: 'UKA00524',
      region: 'Yorkshire & Humber',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_ACTIVE
    },
    {
      '@id': '/api/a_q_s_r_alerts/1189',
      '@type': 'AQSRAlert',
      id: 1189,
      samplingPointId: 1250,
      siteId: 'UKA01102',
      region: 'South West',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_ACTIVE
    },
    {
      '@id': '/api/a_q_s_r_alerts/1191',
      '@type': 'AQSRAlert',
      id: 1191,
      samplingPointId: 1258,
      siteId: 'UKA00482',
      region: 'North West & Merseyside',
      pollutant: 'SO<sub>2</sub> (SO2)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High sulphur dioxide levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_ACTIVE
    },
    {
      '@id': '/api/a_q_s_r_alerts/1193',
      '@type': 'AQSRAlert',
      id: 1193,
      samplingPointId: 1269,
      siteId: 'UKA00644',
      region: 'Greater London',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_ACTIVE
    },
    {
      '@id': '/api/a_q_s_r_alerts/1195',
      '@type': 'AQSRAlert',
      id: 1195,
      samplingPointId: 1279,
      siteId: 'UKA01026',
      region: 'East Midlands',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_ACTIVE
    },
    {
      '@id': '/api/a_q_s_r_alerts/1197',
      '@type': 'AQSRAlert',
      id: 1197,
      samplingPointId: 1283,
      siteId: 'UKA00434',
      region: 'Highland / North East Highlands',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_ACTIVE
    },
    {
      '@id': '/api/a_q_s_r_alerts/1200',
      '@type': 'AQSRAlert',
      id: 1200,
      samplingPointId: 1290,
      siteId: 'UKA00593',
      region: 'West Scotland',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_ACTIVE
    },
    {
      '@id': '/api/a_q_s_r_alerts/1202',
      '@type': 'AQSRAlert',
      id: 1202,
      samplingPointId: 1293,
      siteId: 'UKA00217',
      region: 'South Wales',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_ACTIVE
    },
    {
      '@id': '/api/a_q_s_r_alerts/1204',
      '@type': 'AQSRAlert',
      id: 1204,
      samplingPointId: 1297,
      siteId: 'UKA00212',
      region: 'Northern Ireland',
      pollutant: 'NO<sub>2</sub> (NO2)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High nitrogen dioxide levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_ACTIVE
    },
    // --- PAST breaches (older than 24h) ---
    {
      '@id': '/api/a_q_s_r_alerts/1188',
      '@type': 'AQSRAlert',
      id: 1188,
      samplingPointId: 1241,
      siteId: 'UKA00626',
      region: 'West Midlands',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_PAST
    },
    {
      '@id': '/api/a_q_s_r_alerts/1190',
      '@type': 'AQSRAlert',
      id: 1190,
      samplingPointId: 1254,
      siteId: 'UKA00963',
      region: 'South East',
      pollutant: 'NO<sub>2</sub> (NO2)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High nitrogen dioxide levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_PAST
    },
    {
      '@id': '/api/a_q_s_r_alerts/1192',
      '@type': 'AQSRAlert',
      id: 1192,
      samplingPointId: 1264,
      siteId: 'UKA00484',
      region: 'North East',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: true,
      alertThreshold: null,
      alertLevel: false,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_PAST
    },
    {
      '@id': '/api/a_q_s_r_alerts/1194',
      '@type': 'AQSRAlert',
      id: 1194,
      samplingPointId: 1271,
      siteId: 'UKA00396',
      region: 'Eastern',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_PAST
    },
    {
      '@id': '/api/a_q_s_r_alerts/1196',
      '@type': 'AQSRAlert',
      id: 1196,
      samplingPointId: 1281,
      siteId: 'UKA00420',
      region: 'Central Scotland',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_PAST
    },
    {
      '@id': '/api/a_q_s_r_alerts/1198',
      '@type': 'AQSRAlert',
      id: 1198,
      samplingPointId: 1286,
      siteId: 'UKA00933',
      region: 'North East Scotland',
      pollutant: 'NO<sub>2</sub> (NO2)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High nitrogen dioxide levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_PAST
    },
    {
      '@id': '/api/a_q_s_r_alerts/1199',
      '@type': 'AQSRAlert',
      id: 1199,
      samplingPointId: 1288,
      siteId: 'UKA00130',
      region: 'Scottish Borders',
      pollutant: 'SO<sub>2</sub> (SO2)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High sulphur dioxide levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_PAST
    },
    {
      '@id': '/api/a_q_s_r_alerts/1201',
      '@type': 'AQSRAlert',
      id: 1201,
      samplingPointId: 1292,
      siteId: 'UKA00406',
      region: 'North Wales',
      pollutant: 'SO<sub>2</sub> (SO2)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High sulphur dioxide levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_PAST
    },
    {
      '@id': '/api/a_q_s_r_alerts/1203',
      '@type': 'AQSRAlert',
      id: 1203,
      samplingPointId: 1296,
      siteId: 'UKA00137',
      region: 'Mid Wales',
      pollutant: 'O<sub>3</sub> (O3)',
      informationThreshold: null,
      informationLevel: false,
      alertThreshold: null,
      alertLevel: true,
      concentration: 168,
      duration: null,
      alertText: 'High ozone levels detected',
      coverage: 'tbc',
      validationStatus: 2,
      date: MOCK_ALERT_DATE_PAST
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

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(
      `Ricardo API login failed ${JSON.stringify({ status: response.status, errorText })}`
    )
    throw new Error(
      `Ricardo API login failed: ${response.status} - ${errorText}`
    )
  }

  const data = await response.json()
  const token = data.token

  logger.info(
    `Ricardo API login response keys: ${Object.keys(data).join(', ')}`
  )

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

export async function fetchAlerts(options = {}) {
  if (config.get('ricardoApi.useMock')) {
    logger.info(
      `[MOCK] Returning mock Ricardo alerts response (${MOCK_ALERTS_RESPONSE.totalItems} items)`
    )
    return MOCK_ALERTS_RESPONSE
  }

  const token = await getAccessToken()
  const baseAlertsUrl = config.get('ricardoApi.alertsUrl')
  const { startDate, endDate } = options
  const alertsUrl =
    startDate && endDate
      ? `${baseAlertsUrl}?start-date=${startDate}&end-date=${endDate}`
      : baseAlertsUrl

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

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(
      `Ricardo API alerts fetch failed ${JSON.stringify({ status: response.status, errorText })}`
    )
    throw new Error(
      `Ricardo API alerts fetch failed: ${response.status} - ${errorText}`
    )
  }

  const data = await response.json()
  logger.info(`Fetched ${data.totalItems} alerts from Ricardo API`)
  return data
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

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(
      `Ricardo API site metadata fetch failed ${JSON.stringify({ status: response.status, errorText })}`
    )
    throw new Error(
      `Ricardo API site metadata fetch failed: ${response.status} - ${errorText}`
    )
  }

  const data = await response.json()
  logger.info(`Fetched ${data.totalItems} sites from Ricardo API`)
  return data
}
