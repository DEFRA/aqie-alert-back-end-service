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
      payload: (value, options) => {
        logger.info(
          {
            payload: {
              ...value,
              phoneNumber: maskPhoneNumber(value.phoneNumber),
              emailAddress: maskEmail(value.emailAddress)
            }
          },
          'Validating setup-alert payload'
        )
        const { phoneNumber, emailAddress, alertType, location, lat, long } =
          value

        if (!alertType || !['sms', 'email'].includes(alertType)) {
          logger.warn({ alertType }, 'Invalid alertType provided')
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
            { alertType, error: contactValidation.error },
            'Contact validation failed'
          )
          throw Boom.badRequest(contactValidation.error)
        }

        if (!location || lat == null || long == null) {
          logger.warn({ location, lat, long }, 'Missing required location data')
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
