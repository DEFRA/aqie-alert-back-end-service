import { fetch, Agent, ProxyAgent } from 'undici'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { provideProxy } from '../../common/helpers/proxy/proxy.js'

const logger = createLogger()
const isProduction = process.env.NODE_ENV === 'production'

// ---------------------------------------------------------------------------
// Mock data — used when RICARDO_API_USE_MOCK=true
// Update the "region" values below to match regions registered in your USERS
// collection so the full flow (region matching → notify) can be exercised.
// ---------------------------------------------------------------------------
const MOCK_ALERTS_RESPONSE = {
  '@context': '/api/contexts/AQSRAlert',
  '@id': '/api/aqsr_alerts',
  '@type': 'Collection',
  totalItems: 2,
  member: [
    {
      '@id': '/api/a_q_s_r_alerts/1187',
      '@type': 'AQSRAlert',
      id: 1187,
      samplingPointId: 3311,
      siteId: 'UKA00353',
      region: 'England',
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
      date: '2025-08-13T16:00:00+01:00'
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
  if (config.get('ricardoApi.useMock')) {
    logger.info('[MOCK] Skipping Ricardo API login — returning mock token')
    return 'mock-token'
  }

  const loginUrl = config.get('ricardoApi.loginUrl')
  const email = config.get('ricardoApi.email')
  const password = config.get('ricardoApi.password')

  logger.info('Requesting access token from Ricardo API')

  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
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

export async function fetchAlerts() {
  if (config.get('ricardoApi.useMock')) {
    logger.info(
      `[MOCK] Returning mock Ricardo alerts response (${MOCK_ALERTS_RESPONSE.totalItems} items)`
    )
    return MOCK_ALERTS_RESPONSE
  }

  const token = await getAccessToken()
  const alertsUrl = config.get('ricardoApi.alertsUrl')

  logger.info(
    `Fetching AQSR alerts from Ricardo API ${JSON.stringify({ url: alertsUrl })}`
  )

  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
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
