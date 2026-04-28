import { describe, it, expect, beforeEach, vi } from 'vitest'
import Boom from '@hapi/boom'
import { setupAlert } from './setup-alert.js'

// Mock dependencies
vi.mock('../controllers/setupAlertController.js', () => ({
  setupAlertHandler: vi.fn()
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('../utils/maskingUtils.js', () => ({
  maskPhoneNumber: vi.fn((phone) => (phone ? '***' + phone.slice(-4) : phone)),
  maskEmail: vi.fn((email) => (email ? email.split('@')[0] + '@***' : email))
}))

vi.mock('../utils/validationUtils.js', () => ({
  validateContactInfo: vi.fn(),
  normalizeEmail: vi.fn((email) => (email ? email.trim().toLowerCase() : email))
}))

describe('setup-alert route', () => {
  let mockOptions

  beforeEach(() => {
    vi.clearAllMocks()
    mockOptions = {}
  })

  describe('Route configuration', () => {
    it('should have correct method and path', () => {
      expect(setupAlert.method).toBe('POST')
      expect(setupAlert.path).toBe('/setup-alert')
    })

    it('should have validation options', () => {
      expect(setupAlert.options.validate.payload).toBeDefined()
      expect(typeof setupAlert.options.validate.payload).toBe('function')
    })
  })

  describe('Payload validation', () => {
    let validatePayload

    beforeEach(() => {
      validatePayload = setupAlert.options.validate.payload
    })

    describe('lang validation', () => {
      it('should reject missing lang', () => {
        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          long: -0.1278
        }

        expect(() => validatePayload(payload, mockOptions)).toThrow(
          Boom.badRequest('lang must be en or cy')
        )
      })

      it('should reject invalid lang value', () => {
        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'fr'
        }

        expect(() => validatePayload(payload, mockOptions)).toThrow(
          Boom.badRequest('lang must be en or cy')
        )
      })

      it('should accept lang en', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload)
      })

      it('should accept lang cy', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'cy'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload)
      })
    })

    describe('alertType validation', () => {
      it('should accept valid alertType "sms"', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload)
      })

      it('should accept valid alertType "email"', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          alertType: 'email',
          emailAddress: 'test@example.com',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload)
      })

      it('should reject missing alertType', () => {
        const payload = {
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        expect(() => validatePayload(payload, mockOptions)).toThrow(
          Boom.badRequest('alertType must be sms or email')
        )
      })

      it('should reject invalid alertType', () => {
        const payload = {
          alertType: 'invalid',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        expect(() => validatePayload(payload, mockOptions)).toThrow(
          Boom.badRequest('alertType must be sms or email')
        )
      })
    })

    describe('Contact information validation', () => {
      it('should pass valid SMS contact info', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(validateContactInfo).toHaveBeenCalledWith(
          'sms',
          '07123456789',
          undefined
        )
        expect(result).toEqual(payload)
      })

      it('should pass valid email contact info', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          alertType: 'email',
          emailAddress: 'test@example.com',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(validateContactInfo).toHaveBeenCalledWith(
          'email',
          undefined,
          'test@example.com'
        )
        expect(result).toEqual(payload)
      })

      it('should normalize email to lowercase and trim before validation', async () => {
        const { validateContactInfo, normalizeEmail } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          alertType: 'email',
          emailAddress: '  User@Example.COM  ',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(normalizeEmail).toHaveBeenCalledWith('  User@Example.COM  ')
        expect(validateContactInfo).toHaveBeenCalledWith(
          'email',
          undefined,
          'user@example.com'
        )
        expect(result).toEqual({ ...payload, emailAddress: 'user@example.com' })
      })

      it('should reject invalid contact info', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({
          isValid: false,
          error: 'Invalid phone number format'
        })

        const payload = {
          alertType: 'sms',
          phoneNumber: '123',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        expect(() => validatePayload(payload, mockOptions)).toThrow(
          Boom.badRequest('Invalid phone number format')
        )
      })
    })

    describe('Location validation', () => {
      beforeEach(async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })
      })

      it('should accept valid location data', () => {
        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London, City of Westminster',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload)
      })

      it('should reject missing location', () => {
        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        expect(() => validatePayload(payload, mockOptions)).toThrow(
          Boom.badRequest('location, lat, and long are required')
        )
      })

      it('should reject missing latitude', () => {
        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          long: -0.1278,
          lang: 'en'
        }

        expect(() => validatePayload(payload, mockOptions)).toThrow(
          Boom.badRequest('location, lat, and long are required')
        )
      })

      it('should reject missing longitude', () => {
        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          lang: 'en'
        }

        expect(() => validatePayload(payload, mockOptions)).toThrow(
          Boom.badRequest('location, lat, and long are required')
        )
      })

      it('should reject latitude as 0', () => {
        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 0,
          long: -0.1278,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload) // 0 is valid coordinate
      })

      it('should reject longitude as 0', () => {
        const payload = {
          alertType: 'sms',
          phoneNumber: '07123456789',
          location: 'London',
          lat: 51.5074,
          long: 0,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload) // 0 is valid coordinate
      })
    })

    describe('Complete payload validation', () => {
      it('should validate complete SMS payload', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          phoneNumber: '07123456789',
          alertType: 'sms',
          location: 'London, City of Westminster',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload)
      })

      it('should validate complete email payload', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          emailAddress: 'test@example.com',
          alertType: 'email',
          location: 'Manchester, Greater Manchester',
          lat: 53.4808,
          long: -2.2426,
          lang: 'cy'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload)
      })

      it('should handle complex location names', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        validateContactInfo.mockReturnValue({ isValid: true })

        const payload = {
          phoneNumber: '07123456789',
          alertType: 'sms',
          location: 'Little London, Buckinghamshire',
          lat: 51.6234,
          long: -0.7345,
          lang: 'en'
        }

        const result = validatePayload(payload, mockOptions)
        expect(result).toEqual(payload)
      })
    })

    describe('Logging behavior', () => {
      it('should log validation start with masked data', async () => {
        const { validateContactInfo } = await import(
          '../utils/validationUtils.js'
        )
        const { maskPhoneNumber, maskEmail } = await import(
          '../utils/maskingUtils.js'
        )

        validateContactInfo.mockReturnValue({ isValid: true })
        maskPhoneNumber.mockReturnValue('***6789')
        maskEmail.mockReturnValue('test@***')

        const payload = {
          phoneNumber: '07123456789',
          emailAddress: 'test@example.com',
          alertType: 'sms',
          location: 'London',
          lat: 51.5074,
          long: -0.1278,
          lang: 'en'
        }

        validatePayload(payload, mockOptions)

        expect(maskPhoneNumber).toHaveBeenCalledWith('07123456789')
        expect(maskEmail).toHaveBeenCalledWith('test@example.com')
      })
    })
  })
})
