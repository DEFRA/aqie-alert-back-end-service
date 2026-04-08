import { fetch } from 'undici'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskPhoneNumber, maskEmail, maskTemplateId } from './maskingUtils.js'

const logger = createLogger()

export async function sendNotification(payload, requestId) {
  const finalRequestId =
    requestId ||
    `notify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const startTime = Date.now()
  const serviceUrl = config.get('notification.serviceUrl')

  logger.info(
    `Starting notification service call ${JSON.stringify({
      requestId: finalRequestId,
      payload: {
        ...payload,
        phoneNumber: maskPhoneNumber(payload.phoneNumber),
        emailAddress: maskEmail(payload.emailAddress),
        templateId: maskTemplateId(payload.templateId)
      },
      serviceUrl
    })}`
  )

  const fetchOptions = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': finalRequestId
    },
    body: JSON.stringify(payload)
  }

  logger.info(
    `Prepared fetch options for notification service ${JSON.stringify({
      requestId: finalRequestId,
      headers: fetchOptions.headers,
      bodySize: fetchOptions.body.length
    })}`
  )

  try {
    logger.info(
      `Initiating HTTP request to notification service ${JSON.stringify({ requestId: finalRequestId, serviceUrl })}`
    )
    const response = await fetch(serviceUrl, fetchOptions)
    const duration = Date.now() - startTime

    logger.info(
      `Received response from notification service ${JSON.stringify({
        requestId: finalRequestId,
        status: response.status,
        statusText: response.statusText,
        duration,
        headers: Object.fromEntries(response.headers.entries())
      })}`
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `Notification service returned error response ${JSON.stringify({
          requestId: finalRequestId,
          status: response.status,
          statusText: response.statusText,
          errorText,
          duration
        })}`
      )

      throw new Error(
        `Notification service error: ${response.status} - ${errorText}`
      )
    }

    // Try to read response body for logging
    let responseBody
    try {
      const responseText = await response.text()
      responseBody = responseText ? JSON.parse(responseText) : null
    } catch (parseErr) {
      logger.warn(
        `Could not parse response body ${JSON.stringify({ requestId: finalRequestId, parseErr: parseErr.message })}`
      )
      responseBody = 'Unable to parse response'
    }

    logger.info(
      `Notification service call completed successfully ${JSON.stringify({
        requestId: finalRequestId,
        duration,
        responseBody
      })}`
    )

    return responseBody
  } catch (err) {
    const duration = Date.now() - startTime

    if (err.code === 'ECONNREFUSED') {
      logger.error(
        `Connection refused - notification service may be down ${JSON.stringify(
          {
            requestId: finalRequestId,
            serviceUrl,
            duration,
            errorCode: err.code
          }
        )}`
      )
    } else if (err.code === 'ETIMEDOUT') {
      logger.error(
        `Request timeout - notification service not responding ${JSON.stringify(
          {
            requestId: finalRequestId,
            serviceUrl,
            duration,
            errorCode: err.code
          }
        )}`
      )
    } else {
      logger.error(
        `Notification service call failed with unexpected error ${JSON.stringify(
          {
            requestId: finalRequestId,
            serviceUrl,
            duration,
            err: err.message,
            stack: err.stack,
            errorCode: err.code
          }
        )}`
      )
    }

    throw err
  }
}
