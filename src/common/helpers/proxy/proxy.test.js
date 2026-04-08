import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('undici', () => ({
  ProxyAgent: vi.fn().mockImplementation((opts) => ({
    type: 'ProxyAgent',
    uri: opts.uri
  }))
}))

vi.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: vi.fn().mockImplementation((url) => ({
    type: 'HttpsProxyAgent',
    url
  }))
}))

vi.mock('../../../config.js', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

describe('proxy', () => {
  let configGet

  beforeEach(async () => {
    vi.clearAllMocks()
    const { config } = await import('../../../config.js')
    configGet = config.get
  })

  describe('provideProxy', () => {
    it('should return null when no proxy is configured', async () => {
      configGet.mockReturnValue(null)

      const { provideProxy } = await import('./proxy.js')
      const result = provideProxy()

      expect(result).toBeNull()
    })

    it('should return null when proxy values are empty strings', async () => {
      configGet.mockReturnValue('')

      const { provideProxy } = await import('./proxy.js')
      const result = provideProxy()

      expect(result).toBeNull()
    })

    it('should return proxy object with http proxy URL', async () => {
      configGet.mockImplementation((key) => {
        if (key === 'httpsProxy') return null
        if (key === 'httpProxy') return 'http://proxy.example.com:8080'
        return null
      })

      const { provideProxy } = await import('./proxy.js')
      const result = provideProxy()

      expect(result).not.toBeNull()
      expect(result.url).toBeInstanceOf(URL)
      expect(result.url.origin).toBe('http://proxy.example.com:8080')
      expect(result.port).toBe(80)
      expect(result.proxyAgent).toBeDefined()
      expect(result.httpAndHttpsProxyAgent).toBeDefined()
    })

    it('should return proxy object with https proxy URL', async () => {
      configGet.mockImplementation((key) => {
        if (key === 'httpsProxy') return 'https://secure-proxy.example.com'
        return null
      })

      const { provideProxy } = await import('./proxy.js')
      const result = provideProxy()

      expect(result).not.toBeNull()
      expect(result.port).toBe(443)
    })

    it('should prefer httpsProxy over httpProxy', async () => {
      configGet.mockImplementation((key) => {
        if (key === 'httpsProxy') return 'https://secure-proxy.example.com'
        if (key === 'httpProxy') return 'http://proxy.example.com:8080'
        return null
      })

      const { provideProxy } = await import('./proxy.js')
      const result = provideProxy()

      expect(result.url.origin).toBe('https://secure-proxy.example.com')
    })
  })

  describe('proxyFetch', () => {
    let originalFetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should call fetch directly when no proxy is configured', async () => {
      configGet.mockReturnValue(null)

      const { proxyFetch } = await import('./proxy.js')
      const options = { method: 'GET' }
      await proxyFetch('https://api.example.com', options)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com',
        options
      )
    })

    it('should call fetch with dispatcher when proxy is configured', async () => {
      configGet.mockImplementation((key) => {
        if (key === 'httpsProxy') return 'https://proxy.example.com'
        return null
      })

      const { proxyFetch } = await import('./proxy.js')
      await proxyFetch('https://api.example.com', { method: 'GET' })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com',
        expect.objectContaining({
          method: 'GET',
          dispatcher: expect.objectContaining({ type: 'ProxyAgent' })
        })
      )
    })
  })
})
