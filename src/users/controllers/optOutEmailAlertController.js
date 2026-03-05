import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskEmail } from '../utils/maskingUtils.js'

const logger = createLogger()

export async function optOutEmailAlertHandler(request, h) {
  const { emailAddress } = request.payload
  const db = request.db

  logger.info(
    `{ emailAddress: ${maskEmail(emailAddress)} }`,
    'Opt-out email alert request received'
  )

  try {
    const result = await db
      .collection('USERS')
      .deleteOne({ user_contact: emailAddress })

    if (result.deletedCount === 0) {
      logger.info(
        { emailAddress: maskEmail(emailAddress) },
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
      { emailAddress: maskEmail(emailAddress) },
      'Users email alert successfully opted out'
    )

    return h
      .response({
        success: true,
        emailAddress
      })
      .code(200)
  } catch (err) {
    logger.error(
      { err, emailAddress: maskEmail(emailAddress) },
      'Opt-out email alert failed'
    )

    return h
      .response({
        success: false,
        error: 'Failed to opt-out-email'
      })
      .code(500)
  }
}
