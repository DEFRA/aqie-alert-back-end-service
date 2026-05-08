import { describe, it, expect, beforeEach, vi } from 'vitest'
import Boom from '@hapi/boom'
import { aqsrAlert } from './aqsr-alert.js'

vi.mock('../controllers/aqsrAlertController.js', () => ({
  aqsrAlertHandler: vi.fn()
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('aqsr-alert route', () => {
  let validateQuery

  beforeEach(() => {
    vi.clearAllMocks()
    validateQuery = aqsrAlert.options.validate.query
  })

  describe('Route configuration', () => {
    it('should have correct method and path', () => {
      expect(aqsrAlert.method).toBe('GET')
      expect(aqsrAlert.path).toBe('/aqsr-alert')
    })

    it('should have a validate.query function', () => {
      expect(typeof aqsrAlert.options.validate.query).toBe('function')
    })
  })

  describe('Mode 1 — lat + long + current-day=true', () => {
    it('should return { lat, long, currentDay: true } for valid inputs', () => {
      const result = validateQuery({
        lat: '53.8',
        long: '-1.5',
        'current-day': 'true'
      })
      expect(result).toEqual({ lat: 53.8, long: -1.5, currentDay: true })
    })

    it('should accept current-day as boolean true', () => {
      const result = validateQuery({
        lat: '51.5',
        long: '-0.1',
        'current-day': true
      })
      expect(result).toEqual({ lat: 51.5, long: -0.1, currentDay: true })
    })

    it('should coerce lat and long strings to numbers', () => {
      const result = validateQuery({
        lat: '51.5074',
        long: '-0.1278',
        'current-day': 'true'
      })
      expect(typeof result.lat).toBe('number')
      expect(typeof result.long).toBe('number')
      expect(result.lat).toBe(51.5074)
      expect(result.long).toBe(-0.1278)
    })

    it('should reject missing lat', () => {
      expect(() =>
        validateQuery({ long: '-1.5', 'current-day': 'true' })
      ).toThrow(
        Boom.badRequest('lat and long are required for current-day mode')
      )
    })

    it('should reject missing long', () => {
      expect(() =>
        validateQuery({ lat: '53.8', 'current-day': 'true' })
      ).toThrow(
        Boom.badRequest('lat and long are required for current-day mode')
      )
    })

    it('should reject non-numeric lat', () => {
      expect(() =>
        validateQuery({ lat: 'abc', long: '-1.5', 'current-day': 'true' })
      ).toThrow(Boom.badRequest('lat and long must be valid numbers'))
    })

    it('should reject non-numeric long', () => {
      expect(() =>
        validateQuery({ lat: '53.8', long: '!@#', 'current-day': 'true' })
      ).toThrow(Boom.badRequest('lat and long must be valid numbers'))
    })

    it('should reject NaN as lat value', () => {
      expect(() =>
        validateQuery({ lat: 'NaN', long: '-1.5', 'current-day': 'true' })
      ).toThrow(Boom.badRequest('lat and long must be valid numbers'))
    })

    it('should accept zero as a valid coordinate', () => {
      const result = validateQuery({
        lat: '0',
        long: '0',
        'current-day': 'true'
      })
      expect(result.lat).toBe(0)
      expect(result.long).toBe(0)
    })

    it('should accept negative coordinates', () => {
      const result = validateQuery({
        lat: '-33.8',
        long: '-70.6',
        'current-day': 'true'
      })
      expect(result.lat).toBe(-33.8)
      expect(result.long).toBe(-70.6)
    })
  })

  describe('Mode 2 — start-date + end-date', () => {
    it('should return { startDate, endDate } for valid inputs', () => {
      const result = validateQuery({
        'start-date': '2024-12-01',
        'end-date': '2025-08-13'
      })
      expect(result).toEqual({
        startDate: '2024-12-01',
        endDate: '2025-08-13'
      })
    })

    it('should not include lat or long in the returned value', () => {
      const result = validateQuery({
        'start-date': '2024-12-01',
        'end-date': '2025-08-13'
      })
      expect(result.lat).toBeUndefined()
      expect(result.long).toBeUndefined()
    })

    it('should reject missing start-date', () => {
      expect(() => validateQuery({ 'end-date': '2025-08-13' })).toThrow(
        Boom.badRequest('Both start-date and end-date are required')
      )
    })

    it('should reject missing end-date', () => {
      expect(() => validateQuery({ 'start-date': '2024-12-01' })).toThrow(
        Boom.badRequest('Both start-date and end-date are required')
      )
    })

    it('should reject start-date in wrong format (dd-mm-yyyy)', () => {
      expect(() =>
        validateQuery({
          'start-date': '01-12-2024',
          'end-date': '2025-08-13'
        })
      ).toThrow(
        Boom.badRequest('start-date and end-date must be in yyyy-mm-dd format')
      )
    })

    it('should reject end-date in wrong format (dd/mm/yyyy)', () => {
      expect(() =>
        validateQuery({
          'start-date': '2024-12-01',
          'end-date': '13/08/2025'
        })
      ).toThrow(
        Boom.badRequest('start-date and end-date must be in yyyy-mm-dd format')
      )
    })

    it('should reject invalid calendar date (month 13)', () => {
      expect(() =>
        validateQuery({
          'start-date': '2024-13-01',
          'end-date': '2025-08-13'
        })
      ).toThrow(Boom.badRequest('start-date and end-date must be valid dates'))
    })

    it('should reject invalid calendar date (day 32)', () => {
      expect(() =>
        validateQuery({
          'start-date': '2024-12-32',
          'end-date': '2025-08-13'
        })
      ).toThrow(Boom.badRequest('start-date and end-date must be valid dates'))
    })

    it('should reject end-date before start-date', () => {
      expect(() =>
        validateQuery({
          'start-date': '2025-08-13',
          'end-date': '2024-12-01'
        })
      ).toThrow(Boom.badRequest('end-date must be on or after start-date'))
    })

    it('should accept same start-date and end-date', () => {
      const result = validateQuery({
        'start-date': '2025-01-01',
        'end-date': '2025-01-01'
      })
      expect(result).toEqual({
        startDate: '2025-01-01',
        endDate: '2025-01-01'
      })
    })
  })

  describe('Mode errors', () => {
    it('should reject when no mode is provided', () => {
      expect(() => validateQuery({ lat: '53.8', long: '-1.5' })).toThrow(
        Boom.badRequest(
          'Provide either current-day=true with lat and long, or start-date and end-date'
        )
      )
    })

    it('should reject when no parameters are provided at all', () => {
      expect(() => validateQuery({})).toThrow(
        Boom.badRequest(
          'Provide either current-day=true with lat and long, or start-date and end-date'
        )
      )
    })

    it('should reject when both current-day and date range are provided', () => {
      expect(() =>
        validateQuery({
          lat: '53.8',
          long: '-1.5',
          'current-day': 'true',
          'start-date': '2024-12-01',
          'end-date': '2025-08-13'
        })
      ).toThrow(
        Boom.badRequest(
          'Provide either current-day or start-date/end-date, not both'
        )
      )
    })

    it('should treat current-day=false as not supplying current-day mode', () => {
      expect(() =>
        validateQuery({ lat: '53.8', long: '-1.5', 'current-day': 'false' })
      ).toThrow(
        Boom.badRequest(
          'Provide either current-day=true with lat and long, or start-date and end-date'
        )
      )
    })
  })
})
