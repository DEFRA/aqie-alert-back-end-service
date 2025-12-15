import Boom from '@hapi/boom'
import { setupAlertHandler } from '../controllers/setupAlertController.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskPhoneNumber, maskEmail } from '../utils/maskingUtils.js'

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

        if (alertType === 'sms' && !phoneNumber) {
          logger.warn({ alertType }, 'phoneNumber missing for SMS alert')
          throw Boom.badRequest('phoneNumber is required for sms alerts')
        }

        if (alertType === 'email' && !emailAddress) {
          logger.warn({ alertType }, 'emailAddress missing for email alert')
          throw Boom.badRequest('emailAddress is required for email alerts')
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
