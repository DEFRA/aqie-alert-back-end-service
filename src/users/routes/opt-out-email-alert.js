import Boom from '@hapi/boom'
import { optOutEmailAlertHandler } from '../controllers/optOutEmailAlertController.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskEmail } from '../utils/maskingUtils.js'
import { isValidEmail, normalizeEmail } from '../utils/validationUtils.js'

const logger = createLogger()

const optOutEmailAlert = {
  method: 'DELETE',
  path: '/opt-out-email-alert',
  options: {
    validate: {
      payload: (value) => {
        logger.info(
          `Validating opt-out email alert payload ${JSON.stringify({ payload: { emailAddress: maskEmail(value.emailAddress) } })}`
        )

        const { emailAddress } = value

        if (!emailAddress || typeof emailAddress !== 'string') {
          logger.warn(
            `Invalid emailAddress provided ${JSON.stringify({ emailAddress })}`
          )
          throw Boom.badRequest('emailAddress is required')
        }

        const normalizedEmail = normalizeEmail(emailAddress)

        if (!isValidEmail(normalizedEmail)) {
          logger.warn(
            `Invalid email format ${JSON.stringify({ emailAddress: maskEmail(normalizedEmail) })}`
          )
          throw Boom.badRequest('Invalid email format')
        }

        logger.info('Payload validation successful')
        return { ...value, emailAddress: normalizedEmail }
      }
    }
  },
  handler: optOutEmailAlertHandler
}

export { optOutEmailAlert }
