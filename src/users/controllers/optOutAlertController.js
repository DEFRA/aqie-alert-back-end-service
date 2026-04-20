import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskPhoneNumber } from '../utils/maskingUtils.js'
import {
  USER_NOT_FOUND_STATUS_CODE,
  STATUS_OK,
  INTERNAL_SERVER_ERROR
} from '../utils/constants.js'

const logger = createLogger()

export async function optOutAlertHandler(request, h) {
  const { phoneNumber } = request.payload
  const db = request.db

  logger.info(
    `Opt-out sms alert request received ${JSON.stringify({ phoneNumber: maskPhoneNumber(phoneNumber) })}`
  )

  try {
    const result = await db
      .collection('USERS')
      .deleteOne({ user_contact: phoneNumber })

    if (result.deletedCount === 0) {
      logger.info(
        `User not found for opt-out ${JSON.stringify({ phoneNumber: maskPhoneNumber(phoneNumber) })}`
      )
      return h
        .response({
          success: false,
          error: 'User not found'
        })
        .code(USER_NOT_FOUND_STATUS_CODE)
    }

    logger.info(
      `Users sms alert successfully opted out ${JSON.stringify({ phoneNumber: maskPhoneNumber(phoneNumber) })}`
    )

    return h
      .response({
        success: true,
        phoneNumber
      })
      .code(STATUS_OK)
  } catch (err) {
    logger.error(
      `Opt-out-sms alert failed ${JSON.stringify({ err: err.message, phoneNumber: maskPhoneNumber(phoneNumber) })}`
    )

    return h
      .response({
        success: false,
        error: 'Failed to opt-out-sms'
      })
      .code(INTERNAL_SERVER_ERROR)
  }
}
