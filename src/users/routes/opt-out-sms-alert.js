import Boom from '@hapi/boom'
import { optOutAlertHandler } from '../controllers/optOutAlertController.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskPhoneNumber } from '../utils/maskingUtils.js'

const logger = createLogger()

const optOutAlert = {
  method: 'DELETE',
  path: '/opt-out-sms-alert',
  options: {
    validate: {
      payload: (value) => {
        logger.info(
          `Validating opt-out alert payload ${JSON.stringify({ payload: { phoneNumber: value.phoneNumber } })}`
        )

        const { phoneNumber } = value

        if (!phoneNumber || typeof phoneNumber !== 'string') {
          logger.warn(
            `Invalid phoneNumber provided ${JSON.stringify({ phoneNumber })}`
          )
          throw Boom.badRequest('phoneNumber is required')
        }

        const ukPhoneRegex = /^(\+?44|07)\d{9,10}$/
        if (!ukPhoneRegex.test(phoneNumber.replace(/\s/g, ''))) {
          logger.warn(
            `Invalid UK phone number format ${JSON.stringify({ phoneNumber: maskPhoneNumber(phoneNumber) })}`
          )
          throw Boom.badRequest(
            'phoneNumber must be a valid UK number starting with 07 or +44'
          )
        }

        logger.info('Payload validation successful')
        return value
      }
    }
  },
  handler: optOutAlertHandler
}

export { optOutAlert }
