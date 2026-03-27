import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getAccessToken, fetchAlerts } from './ricardoApiClient.js'

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
        'https://uk-air-api.staging.rcdo.co.uk/api/aqsr_alerts',
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
})
