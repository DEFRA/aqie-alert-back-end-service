import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Validates email address format
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if valid email format
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false
  }

  // Basic email regex pattern
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.trim())
}

/**
 * Validates UK phone number format
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} - True if valid phone number format
 */
export function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return false
  }

  // Remove all non-digit characters for validation
  const cleanNumber = phoneNumber.replace(/\D/g, '')

  // UK phone number patterns:
  // - Mobile: 07xxxxxxxxx (11 digits)
  // - Landline: 01xxxxxxxxx or 02xxxxxxxxx (11 digits)
  // - International format: +44xxxxxxxxxx (13 digits with +44)

  if (phoneNumber.startsWith('+44')) {
    return cleanNumber.length === 13 && cleanNumber.startsWith('44')
  }

  return (
    cleanNumber.length === 11 &&
    (cleanNumber.startsWith('07') || // Mobile
      cleanNumber.startsWith('01') || // Landline
      cleanNumber.startsWith('02')) // Landline
  )
}

/**
 * Validates contact information based on alert type
 * @param {string} alertType - 'sms' or 'email'
 * @param {string} phoneNumber - Phone number (for SMS)
 * @param {string} emailAddress - Email address (for email)
 * @returns {object} - Validation result with isValid and error message
 */
export function validateContactInfo(alertType, phoneNumber, emailAddress) {
  const result = { isValid: false, error: null }

  if (alertType === 'sms') {
    if (!phoneNumber) {
      result.error = 'phoneNumber is required for SMS alerts'
      return result
    }

    if (!isValidPhoneNumber(phoneNumber)) {
      result.error =
        'Invalid phone number format. Please provide a valid UK phone number'
      logger.warn(
        { phoneNumber: phoneNumber?.substring(0, 3) + '***' },
        'Invalid phone number format'
      )
      return result
    }
  }

  if (alertType === 'email') {
    if (!emailAddress) {
      result.error = 'emailAddress is required for email alerts'
      return result
    }

    if (!isValidEmail(emailAddress)) {
      result.error =
        'Invalid email address format. Please provide a valid email address'
      logger.warn(
        { emailAddress: emailAddress?.split('@')[0] + '@***' },
        'Invalid email address format'
      )
      return result
    }
  }

  result.isValid = true
  return result
}
