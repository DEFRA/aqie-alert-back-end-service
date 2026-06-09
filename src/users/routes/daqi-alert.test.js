import { describe, it, expect, vi } from 'vitest'
import { daqiAlert } from './daqi-alert.js'

vi.mock('../controllers/daqiAlertController.js', () => ({
  daqiAlertHandler: vi.fn().mockResolvedValue({ ok: true })
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('daqi-alert route', () => {
  describe('Route configuration', () => {
    it('should have method GET', () => {
      expect(daqiAlert.method).toBe('GET')
    })

    it('should have path /daqi-alert', () => {
      expect(daqiAlert.path).toBe('/daqi-alert')
    })

    it('should expose a handler function', () => {
      expect(typeof daqiAlert.handler).toBe('function')
    })

    it('should declare a description in options', () => {
      expect(daqiAlert.options.description).toBeDefined()
      expect(typeof daqiAlert.options.description).toBe('string')
    })

    it('should not have query/payload validation (no request params expected)', () => {
      expect(daqiAlert.options.validate).toBeUndefined()
    })
  })

  describe('Handler delegation', () => {
    it('should invoke daqiAlertHandler with request and h', async () => {
      const { daqiAlertHandler } = await import(
        '../controllers/daqiAlertController.js'
      )
      const request = { headers: {}, query: {} }
      const h = { response: vi.fn() }

      await daqiAlert.handler(request, h)

      expect(daqiAlertHandler).toHaveBeenCalledWith(request, h)
    })
  })
})
