import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockProxyFetch = vi.fn()

vi.mock('./proxy/proxy.js', () => ({
  proxyFetch: (...args) => mockProxyFetch(...args)
}))

vi.mock('../helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

describe('proxy-fetch', () => {
  let fetchWithProxy

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./proxy-fetch.js')
    fetchWithProxy = mod.fetchWithProxy
  })

  describe('successful responses', () => {
    it('should return status code and parsed JSON for 2xx response', async () => {
      const mockData = { id: 1, name: 'test' }
      mockProxyFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockData)
      })

      const [statusCode, data] = await fetchWithProxy(
        'https://api.example.com/data',
        { method: 'GET' }
      )

      expect(statusCode).toBe(200)
      expect(data).toEqual(mockData)
      expect(mockProxyFetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        { method: 'GET' }
      )
    })
  })

  describe('non-2xx responses', () => {
    it('should return status code and parsed error JSON for non-2xx response', async () => {
      const errorData = { error: 'Not Found', message: 'Resource missing' }
      mockProxyFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue(errorData)
      })

      const [statusCode, data] = await fetchWithProxy(
        'https://api.example.com/missing'
      )

      expect(statusCode).toBe(404)
      expect(data).toEqual(errorData)
    })

    it('should return fallback error when non-2xx response body is not valid JSON', async () => {
      mockProxyFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      })

      const [statusCode, data] = await fetchWithProxy(
        'https://api.example.com/error'
      )

      expect(statusCode).toBe(500)
      expect(data).toEqual({
        error: 'HTTP 500',
        message: 'Internal Server Error'
      })
    })
  })

  describe('network errors', () => {
    it('should return status 0 and error details for network failure', async () => {
      mockProxyFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      const [statusCode, data] = await fetchWithProxy(
        'https://api.example.com/down'
      )

      expect(statusCode).toBe(0)
      expect(data).toEqual({
        error: 'Network Error',
        message: 'ECONNREFUSED'
      })
    })

    it('should return status 0 for timeout errors', async () => {
      mockProxyFetch.mockRejectedValue(new Error('Request timed out'))

      const [statusCode, data] = await fetchWithProxy(
        'https://api.example.com/slow'
      )

      expect(statusCode).toBe(0)
      expect(data.message).toBe('Request timed out')
    })
  })

  describe('options passthrough', () => {
    it('should pass options to proxyFetch', async () => {
      mockProxyFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({})
      })

      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'value' })
      }

      await fetchWithProxy('https://api.example.com/post', options)

      expect(mockProxyFetch).toHaveBeenCalledWith(
        'https://api.example.com/post',
        options
      )
    })
  })
})
