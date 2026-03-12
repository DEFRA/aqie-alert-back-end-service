import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskEmail } from '../utils/maskingUtils.js'

const logger = createLogger()

export async function optOutEmailAlertHandler(request, h) {
  const { emailAddress } = request.payload
  const db = request.db

  logger.info(
    `Opt-out email alert request received ${JSON.stringify({ emailAddress: maskEmail(emailAddress) })}`
  )

  try {
    const result = await db
      .collection('USERS')
      .deleteOne({ user_contact: emailAddress })

    if (result.deletedCount === 0) {
      logger.info(
        `User not found for opt-out ${JSON.stringify({ emailAddress: maskEmail(emailAddress) })}`
      )
      return h
        .response({
          success: false,
          error: 'User not found'
        })
        .code(404)
    }

    logger.info(
      `Users email alert successfully opted out ${JSON.stringify({ emailAddress: maskEmail(emailAddress) })}`
    )

    return h
      .response({
        success: true,
        emailAddress
      })
      .code(200)
  } catch (err) {
    logger.error(
      `Opt-out email alert failed ${JSON.stringify({ err: err.message, emailAddress: maskEmail(emailAddress) })}`
    )

    return h
      .response({
        success: false,
        error: 'Failed to opt-out-email'
      })
      .code(500)
  }
}
