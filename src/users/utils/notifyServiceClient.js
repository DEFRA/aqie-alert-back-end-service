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
    {
      requestId: finalRequestId,
      payload: {
        ...payload,
        phoneNumber: maskPhoneNumber(payload.phoneNumber),
        emailAddress: maskEmail(payload.emailAddress),
        templateId: maskTemplateId(payload.templateId)
      },
      serviceUrl
    },
    'Starting notification service call'
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
    {
      requestId: finalRequestId,
      headers: fetchOptions.headers,
      bodySize: fetchOptions.body.length
    },
    'Prepared fetch options for notification service'
  )

  try {
    logger.info(
      { requestId: finalRequestId, serviceUrl },
      'Initiating HTTP request to notification service'
    )
    const response = await fetch(serviceUrl, fetchOptions)
    const duration = Date.now() - startTime

    logger.info(
      {
        requestId: finalRequestId,
        status: response.status,
        statusText: response.statusText,
        duration,
        headers: Object.fromEntries(response.headers.entries())
      },
      'Received response from notification service'
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        {
          requestId: finalRequestId,
          status: response.status,
          statusText: response.statusText,
          errorText,
          duration
        },
        'Notification service returned error response'
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
        { requestId: finalRequestId, parseErr: parseErr.message },
        'Could not parse response body'
      )
      responseBody = 'Unable to parse response'
    }

    logger.info(
      {
        requestId: finalRequestId,
        duration,
        responseBody
      },
      'Notification service call completed successfully'
    )

    return response
  } catch (err) {
    const duration = Date.now() - startTime

    if (err.code === 'ECONNREFUSED') {
      logger.error(
        {
          requestId: finalRequestId,
          serviceUrl,
          duration,
          errorCode: err.code
        },
        'Connection refused - notification service may be down'
      )
    } else if (err.code === 'ETIMEDOUT') {
      logger.error(
        {
          requestId: finalRequestId,
          serviceUrl,
          duration,
          errorCode: err.code
        },
        'Request timeout - notification service not responding'
      )
    } else {
      logger.error(
        {
          requestId: finalRequestId,
          serviceUrl,
          duration,
          err: err.message,
          stack: err.stack,
          errorCode: err.code
        },
        'Notification service call failed with unexpected error'
      )
    }

    throw err
  }
}
