import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getAccessToken,
  fetchAlerts,
  fetchDaqiAlerts
} from './ricardoApiClient.js'

vi.mock('undici', () => ({
  fetch: vi.fn(),
  Agent: vi.fn().mockImplementation(() => ({ type: 'Agent' })),
  ProxyAgent: vi.fn().mockImplementation(() => ({ type: 'ProxyAgent' }))
}))

vi.mock('../../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      const values = {
        'ricardoApi.loginUrl':
          'https://uk-air-api.staging.rcdo.co.uk/api/login_check',
        'ricardoApi.alertsUrl':
          'https://uk-air-api.staging.rcdo.co.uk/api/aqsr_alerts',
        'ricardoApi.daqiAlertsUrl':
          'https://uk-air-api.staging.rcdo.co.uk/api/daqi_alerts',
        'ricardoApi.email': 'test@example.com',
        'ricardoApi.password': 'test-password'
      }
      return values[key] ?? null
    })
  }
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('../../common/helpers/proxy/proxy.js', () => ({
  provideProxy: vi.fn().mockReturnValue(null)
}))

describe('ricardoApiClient', () => {
  let mockFetch

  beforeEach(async () => {
    vi.clearAllMocks()
    mockFetch = vi.mocked((await import('undici')).fetch)
  })

  describe('getAccessToken', () => {
    it('should return token on successful login', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ token: 'test-token-123' })
      })

      const token = await getAccessToken()

      expect(token).toBe('test-token-123')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://uk-air-api.staging.rcdo.co.uk/api/login_check',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'test-password'
          })
        })
      )
    })

    it('should throw on login failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized')
      })

      await expect(getAccessToken()).rejects.toThrow(
        'Ricardo API login failed: 401 - Unauthorized'
      )
    })

    it('should attach a dispatcher (Agent) for SSL bypass in non-production', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ token: 'tok' })
      })

      await getAccessToken()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ dispatcher: expect.anything() })
      )
    })
  })

  describe('fetchAlerts', () => {
    it('should return alerts data on success', async () => {
      const alertsData = {
        totalItems: 2,
        member: [
          { id: 1, samplingPointId: 331, alertLevel: true },
          { id: 2, samplingPointId: 67, alertLevel: false }
        ]
      }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue(alertsData)
        })

      const result = await fetchAlerts()

      expect(result).toEqual(alertsData)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringMatching(
          /^https:\/\/uk-air-api\.staging\.rcdo\.co\.uk\/api\/aqsr_alerts\?start-date=\d{4}-\d{2}-\d{2}&end-date=\d{4}-\d{2}-\d{2}$/
        ),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      )
    })

    it('should throw on alerts fetch failure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue('Server error')
        })

      await expect(fetchAlerts()).rejects.toThrow(
        'Ricardo API alerts fetch failed: 500 - Server error'
      )
    })

    it('should default to a yesterday→today UK-local window when no options provided', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ totalItems: 0, member: [] })
        })

      await fetchAlerts()

      const ukDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      const now = new Date()
      const expectedEnd = ukDate.format(now)
      const expectedStart = ukDate.format(
        new Date(now.getTime() - 24 * 60 * 60 * 1000)
      )

      expect(mockFetch).toHaveBeenLastCalledWith(
        `https://uk-air-api.staging.rcdo.co.uk/api/aqsr_alerts?start-date=${expectedStart}&end-date=${expectedEnd}`,
        expect.any(Object)
      )
    })

    it('should append start-date and end-date as query params when provided', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ totalItems: 0, member: [] })
        })

      await fetchAlerts({ startDate: '2024-12-01', endDate: '2025-08-13' })

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://uk-air-api.staging.rcdo.co.uk/api/aqsr_alerts?start-date=2024-12-01&end-date=2025-08-13',
        expect.any(Object)
      )
    })

    it('should fill in default end-date (today UK-local) when only startDate is provided', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ totalItems: 0, member: [] })
        })

      await fetchAlerts({ startDate: '2024-12-01' })

      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringMatching(
          /^https:\/\/uk-air-api\.staging\.rcdo\.co\.uk\/api\/aqsr_alerts\?start-date=2024-12-01&end-date=\d{4}-\d{2}-\d{2}$/
        ),
        expect.any(Object)
      )
    })

    it('should use ProxyAgent dispatcher when proxy is configured', async () => {
      const { provideProxy } = await import(
        '../../common/helpers/proxy/proxy.js'
      )
      vi.mocked(provideProxy).mockReturnValueOnce({
        url: new URL('http://proxy.example.com:8080'),
        port: 8080,
        proxyAgent: { type: 'ProxyAgent' }
      })

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'tok' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ totalItems: 0, member: [] })
        })

      await fetchAlerts()

      // ProxyAgent should have been constructed
      const { ProxyAgent } = await import('undici')
      expect(ProxyAgent).toHaveBeenCalled()
    })
  })

  describe('fetchDaqiAlerts', () => {
    it('should call the DAQI endpoint with page=1 and the supplied date range', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ totalItems: 0, member: [] })
        })

      await fetchDaqiAlerts({
        startDate: '2026-06-07',
        endDate: '2026-06-08'
      })

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://uk-air-api.staging.rcdo.co.uk/api/daqi_alerts?page=1&start-date=2026-06-07&end-date=2026-06-08',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      )
    })

    it('should call the DAQI endpoint with only page=1 when no dates are supplied', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ totalItems: 0, member: [] })
        })

      await fetchDaqiAlerts()

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://uk-air-api.staging.rcdo.co.uk/api/daqi_alerts?page=1',
        expect.any(Object)
      )
    })

    it('should return the parsed DAQI response on success', async () => {
      const daqiResponse = {
        totalItems: 1,
        member: [
          {
            id: 7716220260528,
            samplingPointId: 77162,
            siteId: 'UKA00819',
            daqi: 7,
            validationStatus: 2,
            date: '2026-06-08T02:00:00+01:00'
          }
        ]
      }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue(daqiResponse)
        })

      const result = await fetchDaqiAlerts({
        startDate: '2026-06-07',
        endDate: '2026-06-08'
      })

      expect(result).toEqual(daqiResponse)
    })

    it('should throw an error with status attached when DAQI endpoint returns 4xx', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: vi.fn().mockResolvedValue('Unauthorized')
        })

      try {
        await fetchDaqiAlerts({
          startDate: '2026-06-07',
          endDate: '2026-06-08'
        })
        throw new Error('Expected fetchDaqiAlerts to throw')
      } catch (err) {
        expect(err.status).toBe(401)
        expect(err.message).toMatch(/daqi alerts fetch failed/i)
      }
    })

    it('should throw an error with status attached when DAQI endpoint returns 5xx', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ token: 'test-token' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: vi.fn().mockResolvedValue('Service Unavailable')
        })

      try {
        await fetchDaqiAlerts({
          startDate: '2026-06-07',
          endDate: '2026-06-08'
        })
        throw new Error('Expected fetchDaqiAlerts to throw')
      } catch (err) {
        expect(err.status).toBe(503)
      }
    })
  })
})
