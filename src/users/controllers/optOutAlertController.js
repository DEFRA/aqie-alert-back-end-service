import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskPhoneNumber } from '../utils/maskingUtils.js'

const logger = createLogger()

export async function optOutAlertHandler(request, h) {
  const { phoneNumber } = request.payload
  const db = request.db

  logger.info(
    { phoneNumber: maskPhoneNumber(phoneNumber) },
    'Opt-out alert request received'
  )

  try {
    const result = await db
      .collection('USERS')
      .deleteOne({ user_contact: phoneNumber })

    if (result.deletedCount === 0) {
      logger.info(
        { phoneNumber: maskPhoneNumber(phoneNumber) },
        'User not found for opt-out'
      )
      return h
        .response({
          success: false,
          error: 'User not found'
        })
        .code(404)
    }

    logger.info(
      { phoneNumber: maskPhoneNumber(phoneNumber) },
      'User successfully opted out'
    )

    return h
      .response({
        success: true,
        phoneNumber
      })
      .code(200)
  } catch (err) {
    logger.error(
      { err: err.message, phoneNumber: maskPhoneNumber(phoneNumber) },
      'Opt-out alert failed'
    )

    return h
      .response({
        success: false,
        error: 'Failed to opt-out'
      })
      .code(500)
  }
}
