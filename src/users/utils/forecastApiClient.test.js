import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('undici', () => ({
  fetch: vi.fn()
}))

vi.mock('../../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      const values = {
        'metOfficeForecast.forecastApiUrl': 'https://api.metoffice.test'
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

describe('forecastApiClient', () => {
  let mockFetch
  let fetchForecast

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    mockFetch = vi.mocked((await import('undici')).fetch)
    const mod = await import('./forecastApiClient.js')
    fetchForecast = mod.fetchForecast
  })

  it('should return response body on success', async () => {
    const mockBody = {
      forecasts: [
        { id: 1, location: { coordinates: [51.5, -0.1] } },
        { id: 2, location: { coordinates: [53.4, -2.2] } }
      ]
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockBody)
    })

    const result = await fetchForecast()

    expect(result).toEqual(mockBody)
  })

  it('should call the forecast endpoint with GET', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ forecasts: [] })
    })

    await fetchForecast()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.metoffice.test/forecast',
      { method: 'GET' }
    )
  })

  it('should throw when response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('Service Unavailable')
    })

    await expect(fetchForecast()).rejects.toThrow(
      'Forecast API responded with 503: Service Unavailable'
    )
  })

  it('should truncate a large upstream error body in the thrown message', async () => {
    const bigBody = `<html>${'x'.repeat(5000)}</html>`
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue(bigBody)
    })

    const err = await fetchForecast().catch((e) => e)

    expect(err.message.startsWith('Forecast API responded with 500: ')).toBe(
      true
    )
    expect(err.message).not.toContain('xxxxx'.repeat(50)) // no giant body
    expect(err.message.length).toBeLessThan(300)
  })

  it('should handle response body without forecasts property', async () => {
    const mockBody = {}
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockBody)
    })

    const result = await fetchForecast()
    expect(result).toEqual(mockBody)
  })
})
