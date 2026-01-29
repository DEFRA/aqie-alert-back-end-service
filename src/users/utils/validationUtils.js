import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Normalizes UK mobile number to international format
 * @param {string} phoneNumber - Phone number to normalize
 * @returns {string} - Normalized phone number (+447xxxxxxxxx format)
 */
export function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return phoneNumber
  }

  // Remove all non-digit characters
  const cleanNumber = phoneNumber.replace(/\D/g, '')

  // Convert 07 format to +44 format (mobile only)
  if (cleanNumber.startsWith('07') && cleanNumber.length === 11) {
    return '+44' + cleanNumber.substring(1) // 07896543210 -> +447896543210
  }

  // Return as-is if already in +44 format
  return phoneNumber
}

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
 * Validates UK phone number format (mobile numbers only)
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} - True if valid UK mobile number format
 */
export function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return false
  }

  // Remove all non-digit characters for validation
  const cleanNumber = phoneNumber.replace(/\D/g, '')

  // Only accept UK mobile numbers:
  // - 07xxxxxxxxx (11 digits)
  // - +447xxxxxxxxx (13 digits with +44)

  if (phoneNumber.startsWith('+44')) {
    return cleanNumber.length === 12 && cleanNumber.startsWith('447')
  }

  return cleanNumber.length === 11 && cleanNumber.startsWith('07')
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
