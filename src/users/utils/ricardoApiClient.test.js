import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('undici', () => ({
  fetch: vi.fn(),
  Agent: vi.fn(),
  ProxyAgent: vi.fn()
}))

vi.mock('../../config.js', () => ({
  config: { get: vi.fn() }
}))

vi.mock('../../common/helpers/proxy/proxy.js', () => ({
  provideProxy: vi.fn()
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

const CONFIG_VALUES = {
  'ricardoApi.loginUrl': 'https://ricardo.test/login',
  'ricardoApi.email': 'user@test.com',
  'ricardoApi.password': 'secret',
  'ricardoApi.alertsUrl': 'https://ricardo.test/alerts',
  'ricardoApi.daqiAlertsUrl': 'https://ricardo.test/daqi',
  'ricardoApi.siteMetaDataUrl': 'https://ricardo.test/sites',
  'ricardoApi.daqiMockUrl': 'https://wiremock.test/daqi_alerts',
  'ricardoApi.aqsrMockUrl': 'https://wiremock.test/aqsr_alerts'
}

function makeResponse({ ok = true, status = 200, json = {}, text = '' } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(json),
    text: vi.fn().mockResolvedValue(text)
  }
}

/**
 * Resets the module registry, sets NODE_ENV, re-imports the mocked deps and the
 * module under test, then wires up sensible defaults. Returns everything a test
 * needs. Because isProduction is evaluated at import time, this is the only way
 * to exercise both the production and non-production dispatcher branches.
 */
async function setup({ nodeEnv = 'test', useMock = false, proxy = null } = {}) {
  vi.resetModules()
  const prevEnv = process.env.NODE_ENV
  process.env.NODE_ENV = nodeEnv

  const undici = await import('undici')
  const { config } = await import('../../config.js')
  const proxyModule = await import('../../common/helpers/proxy/proxy.js')

  config.get.mockImplementation((key) =>
    key === 'ricardoApi.useMock' ? useMock : CONFIG_VALUES[key]
  )
  proxyModule.provideProxy.mockReturnValue(proxy)

  // Default: POST (login) returns a token; GET (data) returns a collection.
  undici.fetch.mockImplementation((url, options) =>
    Promise.resolve(
      options.method === 'POST'
        ? makeResponse({ json: { token: 'test-token' } })
        : makeResponse({ json: { totalItems: 1, member: [] } })
    )
  )

  const client = await import('./ricardoApiClient.js')
  process.env.NODE_ENV = prevEnv

  return {
    ...client,
    fetch: undici.fetch,
    Agent: undici.Agent,
    ProxyAgent: undici.ProxyAgent,
    config,
    provideProxy: proxyModule.provideProxy
  }
}

const getCall = (fetch) =>
  fetch.mock.calls.find(([, options]) => options.method === 'GET')
const postCall = (fetch) =>
  fetch.mock.calls.find(([, options]) => options.method === 'POST')

describe('ricardoApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getAccessToken', () => {
    it('returns the token and POSTs credentials to the login URL', async () => {
      const { getAccessToken, fetch } = await setup()

      const token = await getAccessToken()

      expect(token).toBe('test-token')
      const [url, options] = postCall(fetch)
      expect(url).toBe('https://ricardo.test/login')
      expect(options.method).toBe('POST')
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(JSON.parse(options.body)).toEqual({
        email: 'user@test.com',
        password: 'secret'
      })
    })

    it('throws when login succeeds but no token is present', async () => {
      const { getAccessToken, fetch } = await setup()
      fetch.mockResolvedValue(makeResponse({ json: { somethingElse: 1 } }))

      await expect(getAccessToken()).rejects.toThrow(
        'no token field found in response'
      )
    })

    it('throws a status-carrying error when login responds not-ok', async () => {
      const { getAccessToken, fetch } = await setup()
      fetch.mockResolvedValue(
        makeResponse({ ok: false, status: 401, text: 'Unauthorized' })
      )

      await expect(getAccessToken()).rejects.toMatchObject({
        message: 'Ricardo API login failed: 401',
        status: 401,
        body: 'Unauthorized'
      })
    })

    it('keeps a large upstream error body out of err.message but preserves it on err.body', async () => {
      const bigBody = `<html>${'x'.repeat(5000)}</html>`
      const { getAccessToken, fetch } = await setup()
      fetch.mockResolvedValue(
        makeResponse({ ok: false, status: 403, text: bigBody })
      )

      const err = await getAccessToken().catch((e) => e)

      // The huge body must NOT be baked into the message (which downstream
      // catches log), but should remain available on err.body.
      expect(err.message).toBe('Ricardo API login failed: 403')
      expect(err.message).not.toContain('<html>')
      expect(err.body).toBe(bigBody)
    })
  })

  describe('getRicardoDispatcher (via fetch options)', () => {
    it('non-production without proxy builds an Agent with rejectUnauthorized false', async () => {
      const { getAccessToken, Agent, fetch } = await setup({ nodeEnv: 'test' })

      await getAccessToken()

      expect(Agent).toHaveBeenCalledWith({
        connect: { rejectUnauthorized: false }
      })
      expect(postCall(fetch)[1].dispatcher).toBeInstanceOf(Agent)
    })

    it('non-production with proxy builds a ProxyAgent from the proxy URL', async () => {
      const proxy = { url: { toString: () => 'http://proxy.test:8080' } }
      const { getAccessToken, ProxyAgent } = await setup({
        nodeEnv: 'test',
        proxy
      })

      await getAccessToken()

      expect(ProxyAgent).toHaveBeenCalledWith({
        uri: 'http://proxy.test:8080',
        connect: { rejectUnauthorized: false },
        keepAliveTimeout: 10,
        keepAliveMaxTimeout: 10
      })
    })

    it('production without proxy attaches no dispatcher', async () => {
      const { getAccessToken, fetch, Agent, ProxyAgent } = await setup({
        nodeEnv: 'production'
      })

      await getAccessToken()

      const [, options] = postCall(fetch)
      expect('dispatcher' in options).toBe(false)
      expect(Agent).not.toHaveBeenCalled()
      expect(ProxyAgent).not.toHaveBeenCalled()
    })

    it('production with proxy reuses the proxy proxyAgent', async () => {
      const proxyAgent = { id: 'shared-proxy-agent' }
      const { getAccessToken, fetch } = await setup({
        nodeEnv: 'production',
        proxy: { proxyAgent, url: { toString: () => 'http://p' } }
      })

      await getAccessToken()

      expect(postCall(fetch)[1].dispatcher).toBe(proxyAgent)
    })
  })

  describe('fetchAlerts', () => {
    it('fetches with a default rolling 24h date range when no options given', async () => {
      const { fetchAlerts, fetch } = await setup()

      const data = await fetchAlerts()

      expect(data).toEqual({ totalItems: 1, member: [] })
      const [url, options] = getCall(fetch)
      expect(url).toMatch(
        /^https:\/\/ricardo\.test\/alerts\?start-date=\d{4}-\d{2}-\d{2}&end-date=\d{4}-\d{2}-\d{2}$/
      )
      expect(options.headers.Authorization).toBe('Bearer test-token')
      expect(options.headers.Accept).toBe('application/ld+json')
    })

    it('fetches with explicit start and end dates when provided', async () => {
      const { fetchAlerts, fetch } = await setup()

      await fetchAlerts({ startDate: '2026-01-01', endDate: '2026-01-02' })

      expect(getCall(fetch)[0]).toBe(
        'https://ricardo.test/alerts?start-date=2026-01-01&end-date=2026-01-02'
      )
    })

    it('throws a status-carrying error when the alerts fetch responds not-ok', async () => {
      const { fetchAlerts, fetch } = await setup()
      fetch.mockImplementation((url, options) =>
        Promise.resolve(
          options.method === 'POST'
            ? makeResponse({ json: { token: 'test-token' } })
            : makeResponse({ ok: false, status: 503, text: 'Unavailable' })
        )
      )

      await expect(fetchAlerts()).rejects.toMatchObject({
        message: 'Ricardo API alerts fetch failed: 503',
        status: 503,
        body: 'Unavailable'
      })
    })

    it('calls the WireMock AQSR stub URL when useMock is true and returns its response', async () => {
      const wiremockResponse = {
        totalItems: 1,
        member: [{ id: 1187, siteId: 'UKA00128', alertLevel: true }]
      }
      const { fetchAlerts, fetch } = await setup({ useMock: true })
      fetch.mockResolvedValue(makeResponse({ json: wiremockResponse }))

      const data = await fetchAlerts()

      expect(data).toEqual(wiremockResponse)
      expect(fetch).toHaveBeenCalledWith(
        'https://wiremock.test/aqsr_alerts',
        expect.objectContaining({ signal: expect.any(Object) })
      )
    })

    it('does NOT call the real Ricardo alerts endpoint when useMock is true', async () => {
      const { fetchAlerts, fetch } = await setup({ useMock: true })
      fetch.mockResolvedValue(
        makeResponse({ json: { totalItems: 0, member: [] } })
      )

      await fetchAlerts()

      const realApiCall = fetch.mock.calls.find(([url]) =>
        url.includes('ricardo.test/alerts')
      )
      expect(realApiCall).toBeUndefined()
    })

    it('throws when useMock is true and the WireMock AQSR stub returns a non-ok response', async () => {
      const { fetchAlerts, fetch } = await setup({ useMock: true })
      fetch.mockResolvedValue(makeResponse({ ok: false, status: 503 }))

      await expect(fetchAlerts()).rejects.toThrow(
        'WireMock AQSR stub returned 503'
      )
    })
  })

  describe('fetchDaqiAlerts', () => {
    it('builds a paged URL with start and end dates when both are provided', async () => {
      const { fetchDaqiAlerts, fetch } = await setup()

      await fetchDaqiAlerts({ startDate: '2026-02-01', endDate: '2026-02-02' })

      expect(getCall(fetch)[0]).toBe(
        'https://ricardo.test/daqi?start-date=2026-02-01&end-date=2026-02-02'
      )
    })

    it('builds a page-1-only URL when dates are omitted', async () => {
      const { fetchDaqiAlerts, fetch } = await setup()

      await fetchDaqiAlerts()

      expect(getCall(fetch)[0]).toBe('https://ricardo.test/daqi')
    })

    it('calls the WireMock stub URL when useMock is true and returns its response', async () => {
      const wiremockResponse = { totalItems: 2, member: [{ id: 1 }, { id: 2 }] }
      const { fetchDaqiAlerts, fetch } = await setup({ useMock: true })
      fetch.mockResolvedValue(makeResponse({ json: wiremockResponse }))

      const data = await fetchDaqiAlerts()

      expect(data).toEqual(wiremockResponse)
      expect(fetch).toHaveBeenCalledWith(
        'https://wiremock.test/daqi_alerts',
        expect.objectContaining({ signal: expect.any(Object) })
      )
    })

    it('throws when useMock is true and the WireMock stub returns a non-ok response', async () => {
      const { fetchDaqiAlerts, fetch } = await setup({ useMock: true })
      fetch.mockResolvedValue(makeResponse({ ok: false, status: 503 }))

      await expect(fetchDaqiAlerts()).rejects.toThrow(
        'WireMock DAQI stub returned 503'
      )
    })
  })

  describe('fetchSiteMetaData', () => {
    it('performs an authenticated GET against the site metadata URL', async () => {
      const { fetchSiteMetaData, fetch } = await setup()
      fetch.mockImplementation((url, options) =>
        Promise.resolve(
          options.method === 'POST'
            ? makeResponse({ json: { token: 'test-token' } })
            : makeResponse({ json: { totalItems: 42, member: [] } })
        )
      )

      const data = await fetchSiteMetaData()

      expect(data.totalItems).toBe(42)
      expect(getCall(fetch)[0]).toBe('https://ricardo.test/sites')
    })
  })
})
