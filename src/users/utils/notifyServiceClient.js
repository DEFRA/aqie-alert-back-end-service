import { randomUUID } from 'node:crypto'
import { fetch } from 'undici'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { maskPhoneNumber, maskEmail, maskTemplateId } from './maskingUtils.js'

const logger = createLogger()
// Cap how much of an upstream error body we log / -surface in err.message, so a
// large error/HTML body can't flood the logs on every failed notification.
const ERROR_BODY_LOG_LIMIT = 200

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFetchOptions(payload, finalRequestId) {
  const options = {
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
      headers: options.headers,
      bodySize: options.body.length
    })}`
  )

  return options
}

async function parseResponseBody(response, finalRequestId) {
  try {
    const responseText = await response.text()
    return responseText ? JSON.parse(responseText) : null
  } catch (parseErr) {
    logger.warn(
      `Could not parse response body ${JSON.stringify({ requestId: finalRequestId, parseErr: parseErr.message })}`
    )
    return 'Unable to parse response'
  }
}

async function handleNotifyResponse(response, finalRequestId, startTime) {
  const duration = Date.now() - startTime

  logger.info(
    `Received response from notification service ${JSON.stringify({
      requestId: finalRequestId,
      status: response.status,
      statusText: response.statusText,
      duration
    })}`
  )

  if (!response.ok) {
    const errorText = await response.text()
    const errorSnippet = errorText.slice(0, ERROR_BODY_LOG_LIMIT)
    logger.error(
      `Notification service returned error response ${JSON.stringify({
        requestId: finalRequestId,
        status: response.status,
        statusText: response.statusText,
        errorSnippet,
        duration
      })}`
    )
    throw new Error(
      `Notification service error: ${response.status} - ${errorSnippet}`
    )
  }

  const responseBody = await parseResponseBody(response, finalRequestId)

  // Log only the notificationId, not the whole Notify response body — the body
  // echoes the rendered message content (SMS/email text), which we must not
  // write to logs (PII), and it adds noise on every successful send.
  logger.info(
    `Notification service call completed successfully ${JSON.stringify({
      requestId: finalRequestId,
      duration,
      notificationId: responseBody?.notificationId ?? null
    })}`
  )

  return responseBody
}

function logNotifyError(err, finalRequestId, serviceUrl, duration) {
  if (err.code === 'ECONNREFUSED') {
    logger.error(
      `Connection refused - notification service may be down ${JSON.stringify({
        requestId: finalRequestId,
        serviceUrl,
        duration,
        errorCode: err.code
      })}`
    )
  } else if (err.code === 'ETIMEDOUT') {
    logger.error(
      `Request timeout - notification service not responding ${JSON.stringify({
        requestId: finalRequestId,
        serviceUrl,
        duration,
        errorCode: err.code
      })}`
    )
  } else {
    logger.error(
      `Notification service call failed with unexpected error ${JSON.stringify({
        requestId: finalRequestId,
        serviceUrl,
        duration,
        err: err.message,
        stack: err.stack,
        errorCode: err.code
      })}`
    )
  }
}

// ── Exported function ─────────────────────────────────────────────────────────

export async function sendNotification(payload, requestId) {
  const finalRequestId = requestId || `notify-${randomUUID()}`
  const startTime = Date.now()
  const serviceUrl = config.get('notification.serviceUrl')

  const { personalisation, ...loggablePayload } = payload
  logger.info(
    `Starting notification service call ${JSON.stringify({
      requestId: finalRequestId,
      payload: {
        ...loggablePayload,
        phoneNumber: maskPhoneNumber(payload.phoneNumber),
        emailAddress: maskEmail(payload.emailAddress),
        templateId: maskTemplateId(payload.templateId)
      },
      serviceUrl
    })}`
  )

  const fetchOptions = buildFetchOptions(payload, finalRequestId)

  try {
    logger.info(
      `Initiating HTTP request to notification service ${JSON.stringify({ requestId: finalRequestId, serviceUrl })}`
    )
    const response = await fetch(serviceUrl, fetchOptions)
    return await handleNotifyResponse(response, finalRequestId, startTime)
  } catch (err) {
    logNotifyError(err, finalRequestId, serviceUrl, Date.now() - startTime)
    throw err
  }
}
