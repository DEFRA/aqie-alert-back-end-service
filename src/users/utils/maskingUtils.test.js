import { describe, it, expect } from 'vitest'
import { maskPhoneNumber, maskEmail, maskTemplateId } from './maskingUtils.js'

describe('maskingUtils', () => {
  describe('maskPhoneNumber', () => {
    it('should mask valid phone numbers', () => {
      expect(maskPhoneNumber('07123456789')).toBe('****6789')
      expect(maskPhoneNumber('01234567890')).toBe('****7890')
      expect(maskPhoneNumber('+447123456789')).toBe('****6789')
    })

    it('should handle short phone numbers', () => {
      expect(maskPhoneNumber('123')).toBe('****')
      expect(maskPhoneNumber('1234')).toBe('****')
    })

    it('should handle edge cases', () => {
      expect(maskPhoneNumber('')).toBe(null)
      expect(maskPhoneNumber(null)).toBe(null)
      expect(maskPhoneNumber(undefined)).toBe(null)
      expect(maskPhoneNumber(123456789)).toBe(null)
    })

    it('should handle very long numbers', () => {
      expect(maskPhoneNumber('123456789012345')).toBe('****2345')
    })
  })

  describe('maskEmail', () => {
    it('should mask valid email addresses', () => {
      expect(maskEmail('test@example.com')).toBe('te****@example.com')
      expect(maskEmail('user@domain.co.uk')).toBe('us****@domain.co.uk')
      expect(maskEmail('a@b.com')).toBe('a****@b.com')
    })

    it('should handle short local parts', () => {
      expect(maskEmail('ab@example.com')).toBe('ab****@example.com')
      expect(maskEmail('x@example.com')).toBe('x****@example.com')
    })

    it('should handle invalid email formats', () => {
      expect(maskEmail('invalid-email')).toBe('****')
      expect(maskEmail('test@')).toBe('****')
      expect(maskEmail('@domain.com')).toBe('****@domain.com')
    })

    it('should handle edge cases', () => {
      expect(maskEmail('')).toBe(null)
      expect(maskEmail(null)).toBe(null)
      expect(maskEmail(undefined)).toBe(null)
      expect(maskEmail(12345)).toBe(null)
    })

    it('should handle complex email addresses', () => {
      expect(maskEmail('user.name+tag@example.com')).toBe('us****@example.com')
      expect(maskEmail('very.long.email.address@domain.com')).toBe(
        've****@domain.com'
      )
    })
  })

  describe('maskTemplateId', () => {
    it('should mask valid template IDs', () => {
      expect(maskTemplateId('73244097-acce-4e7b-84f2-3ddcd0e70fb5')).toBe(
        '****0fb5'
      )
      expect(maskTemplateId('email-template-id')).toBe('****e-id')
      expect(maskTemplateId('123456789')).toBe('****6789')
    })

    it('should handle short template IDs', () => {
      expect(maskTemplateId('short')).toBe('****')
      expect(maskTemplateId('1234')).toBe('****')
      expect(maskTemplateId('12345678')).toBe('****')
    })

    it('should handle edge cases', () => {
      expect(maskTemplateId('')).toBe(null)
      expect(maskTemplateId(null)).toBe(null)
      expect(maskTemplateId(undefined)).toBe(null)
      expect(maskTemplateId(123456789)).toBe(null)
    })

    it('should handle very long template IDs', () => {
      expect(maskTemplateId('very-long-template-id-with-many-characters')).toBe(
        '****ters'
      )
    })
  })

  describe('Type safety', () => {
    it('should handle non-string inputs consistently', () => {
      const nonStringInputs = [123, true, false, [], {}, Symbol('test')]

      nonStringInputs.forEach((input) => {
        expect(maskPhoneNumber(input)).toBe(null)
        expect(maskEmail(input)).toBe(null)
        expect(maskTemplateId(input)).toBe(null)
      })
    })
  })

  describe('Security considerations', () => {
    it('should not expose original data in masked output', () => {
      const phone = '07123456789'
      const email = 'sensitive@example.com'
      const templateId = 'secret-template-123'

      const maskedPhone = maskPhoneNumber(phone)
      const maskedEmail = maskEmail(email)
      const maskedTemplate = maskTemplateId(templateId)

      expect(maskedPhone).not.toContain('07123')
      expect(maskedEmail).not.toContain('sensitive')
      expect(maskedTemplate).not.toContain('secret')
    })

    it('should consistently mask same inputs', () => {
      const phone = '07123456789'
      const email = 'test@example.com'
      const templateId = 'template-123'

      expect(maskPhoneNumber(phone)).toBe(maskPhoneNumber(phone))
      expect(maskEmail(email)).toBe(maskEmail(email))
      expect(maskTemplateId(templateId)).toBe(maskTemplateId(templateId))
    })
  })
})
