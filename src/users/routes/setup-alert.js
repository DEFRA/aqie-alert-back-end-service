import Boom from '@hapi/boom'
import { setupAlertHandler } from '../controllers/setupAlertController.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskPhoneNumber, maskEmail } from '../utils/maskingUtils.js'
import { validateContactInfo } from '../utils/validationUtils.js'

const logger = createLogger()

/**
 * POST /setup-alert
 * Body: { phoneNumber/emailAddress, alertType, location, lat, long }
 * All fields are mandatory.
 * Stores in USERS collection, then calls /send-notification.
 */
const setupAlert = {
  method: 'POST',
  path: '/setup-alert',
  options: {
    validate: {
      payload: (value) => {
        logger.info(
          `Validating setup-alert payload ${JSON.stringify({
            payload: {
              ...value,
              phoneNumber: maskPhoneNumber(value.phoneNumber),
              emailAddress: maskEmail(value.emailAddress)
            }
          })}`
        )
        const {
          phoneNumber,
          emailAddress,
          alertType,
          location,
          lat,
          long,
          lang
        } = value

        if (!lang || !['en', 'cy'].includes(lang)) {
          logger.warn(`Invalid lang provided ${JSON.stringify({ lang })}`)
          throw Boom.badRequest('lang must be en or cy')
        }

        if (!alertType || !['sms', 'email'].includes(alertType)) {
          logger.warn(
            `Invalid alertType provided ${JSON.stringify({ alertType })}`
          )
          throw Boom.badRequest('alertType must be sms or email')
        }

        // Validate contact information based on alert type
        const contactValidation = validateContactInfo(
          alertType,
          phoneNumber,
          emailAddress
        )
        if (!contactValidation.isValid) {
          logger.warn(
            `Contact validation failed ${JSON.stringify({ alertType, error: contactValidation.error })}`
          )
          throw Boom.badRequest(contactValidation.error)
        }

        if (!location || lat == null || long == null) {
          logger.warn(
            `Missing required location data ${JSON.stringify({ location, lat, long })}`
          )
          throw Boom.badRequest('location, lat, and long are required')
        }

        logger.info('Payload validation successful')
        return value
      }
    }
  },
  handler: setupAlertHandler
}

export { setupAlert }
