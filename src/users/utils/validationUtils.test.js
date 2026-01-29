import { describe, it, expect } from 'vitest'
import {
  isValidEmail,
  isValidPhoneNumber,
  validateContactInfo,
  normalizePhoneNumber
} from './validationUtils.js'

describe('validationUtils', () => {
  describe('isValidEmail', () => {
    it('should validate correct email formats', () => {
      expect(isValidEmail('test@example.com')).toBe(true)
      expect(isValidEmail('user.name@domain.co.uk')).toBe(true)
      expect(isValidEmail('test+tag@example.org')).toBe(true)
    })

    it('should reject invalid email formats', () => {
      expect(isValidEmail('sa****@cognizant')).toBe(false) // Your example
      expect(isValidEmail('invalid-email')).toBe(false)
      expect(isValidEmail('test@')).toBe(false)
      expect(isValidEmail('@domain.com')).toBe(false)
      expect(isValidEmail('')).toBe(false)
      expect(isValidEmail(null)).toBe(false)
      expect(isValidEmail(undefined)).toBe(false)
    })
  })

  describe('isValidPhoneNumber', () => {
    it('should validate correct UK mobile number formats only', () => {
      expect(isValidPhoneNumber('07896543210')).toBe(true) // Mobile
      expect(isValidPhoneNumber('+447896543210')).toBe(true) // International mobile
      expect(isValidPhoneNumber('07123 456 789')).toBe(true) // With spaces
      expect(isValidPhoneNumber('07123-456-789')).toBe(true) // With dashes
    })

    it('should reject non-mobile UK numbers and invalid formats', () => {
      expect(isValidPhoneNumber('01234567890')).toBe(false) // Landline - not allowed
      expect(isValidPhoneNumber('02012345678')).toBe(false) // London landline - not allowed
      expect(isValidPhoneNumber('123456789')).toBe(false) // Too short
      expect(isValidPhoneNumber('071234567890')).toBe(false) // Too long
      expect(isValidPhoneNumber('08123456789')).toBe(false) // Invalid prefix
      expect(isValidPhoneNumber('')).toBe(false)
      expect(isValidPhoneNumber(null)).toBe(false)
      expect(isValidPhoneNumber(undefined)).toBe(false)
    })
  })

  describe('normalizePhoneNumber', () => {
    it('should normalize UK mobile numbers to +44 international format', () => {
      expect(normalizePhoneNumber('07896543210')).toBe('+447896543210')
      expect(normalizePhoneNumber('+447896543210')).toBe('+447896543210')
    })
  })

  describe('validateContactInfo', () => {
    it('should validate SMS alert with valid mobile number', () => {
      const result = validateContactInfo('sms', '07896543210', null)
      expect(result.isValid).toBe(true)
      expect(result.error).toBe(null)
    })

    it('should reject SMS alert with invalid phone number', () => {
      const result = validateContactInfo('sms', '123456', null)
      expect(result.isValid).toBe(false)
      expect(result.error).toBe(
        'Invalid phone number format. Please provide a valid UK phone number'
      )
    })

    it('should reject SMS alert with landline number', () => {
      const result = validateContactInfo('sms', '01234567890', null)
      expect(result.isValid).toBe(false)
      expect(result.error).toBe(
        'Invalid phone number format. Please provide a valid UK phone number'
      )
    })

    it('should validate email alert with valid email', () => {
      const result = validateContactInfo('email', null, 'test@example.com')
      expect(result.isValid).toBe(true)
      expect(result.error).toBe(null)
    })

    it('should reject email alert with invalid email', () => {
      const result = validateContactInfo('email', null, 'sa****@cognizant')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe(
        'Invalid email address format. Please provide a valid email address'
      )
    })

    it('should reject SMS alert without phone number', () => {
      const result = validateContactInfo('sms', null, null)
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('phoneNumber is required for SMS alerts')
    })

    it('should reject email alert without email address', () => {
      const result = validateContactInfo('email', null, null)
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('emailAddress is required for email alerts')
    })
  })
})
