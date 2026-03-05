import Boom from '@hapi/boom'
import { optOutEmailAlertHandler } from '../controllers/optOutEmailAlertController.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskEmail } from '../utils/maskingUtils.js'

const logger = createLogger()

const optOutEmailAlert = {
  method: 'DELETE',
  path: '/opt-out-email-alert',
  options: {
    validate: {
      payload: (value) => {
        logger.info(
          { payload: { emailAddress: maskEmail(value.emailAddress) } },
          'Validating opt-out email alert payload'
        )

        const { emailAddress } = value

        if (!emailAddress || typeof emailAddress !== 'string') {
          logger.warn({ emailAddress }, 'Invalid emailAddress provided')
          throw Boom.badRequest('emailAddress is required')
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(emailAddress)) {
          logger.warn(
            { emailAddress: maskEmail(emailAddress) },
            'Invalid email format'
          )
          throw Boom.forbidden('Invalid email format')
        }

        logger.info('Payload validation successful')
        return value
      }
    }
  },
  handler: optOutEmailAlertHandler
}

export { optOutEmailAlert }
