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

    it('should declare a query validation function', () => {
      expect(typeof daqiAlert.options.validate.query).toBe('function')
    })
  })

  describe('Query validation', () => {
    const validate = (value) => daqiAlert.options.validate.query(value)

    it('should return parsed numeric lat/long for valid coordinates', () => {
      expect(validate({ lat: '53.4', long: '-2.2' })).toEqual({
        lat: 53.4,
        long: -2.2
      })
    })

    it('should throw 400 when lat is missing', () => {
      expect(() => validate({ long: '-2.2' })).toThrowError(
        /lat and long are required/
      )
    })

    it('should throw 400 when long is missing', () => {
      expect(() => validate({ lat: '53.4' })).toThrowError(
        /lat and long are required/
      )
    })

    it('should throw 400 when coordinates are not valid numbers', () => {
      expect(() => validate({ lat: 'abc', long: '-2.2' })).toThrowError(
        /lat and long must be valid numbers/
      )
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
