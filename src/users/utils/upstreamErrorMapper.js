import Boom from '@hapi/boom'

const HTTP_CLIENT_ERROR_MIN = 400
const HTTP_SERVER_ERROR_MIN = 500
const HTTP_SERVER_ERROR_MAX = 599

function attachUpstreamStatus(boomErr, upstreamStatus) {
  boomErr.output.payload.upstreamStatus = upstreamStatus
  return boomErr
}

/**
 * Maps an upstream API error to a Boom HTTP response that preserves the
 * original status code (4xx → 4xx, 5xx → 5xx). Errors without a status
 * (network failures, timeouts, etc.) default to 502 Bad Gateway.
 *
 * The response body is enriched with `upstreamStatus` so API consumers can
 * see what the upstream service returned without needing access to server
 * logs. `upstreamStatus` is `null` when the upstream call never produced
 * a response (e.g. timeout, DNS failure).
 *
 * @param {Error} err - Error from the upstream call, expected to carry `err.status` when set by `ensureRicardoResponseOk`.
 * @param {string} serviceName - Human-readable service name used in the error message (e.g. "Air quality alert service").
 * @returns {Boom.Boom} Boom error ready to return from a Hapi handler.
 */
export function mapUpstreamError(err, serviceName) {
  const upstreamStatus = err?.status
  if (
    typeof upstreamStatus === 'number' &&
    upstreamStatus >= HTTP_CLIENT_ERROR_MIN &&
    upstreamStatus <= HTTP_SERVER_ERROR_MAX
  ) {
    const message =
      upstreamStatus >= HTTP_SERVER_ERROR_MIN
        ? `${serviceName} upstream error`
        : `${serviceName} rejected the request`
    return attachUpstreamStatus(
      new Boom.Boom(message, { statusCode: upstreamStatus }),
      upstreamStatus
    )
  }

  return attachUpstreamStatus(
    Boom.badGateway(`${serviceName} temporarily unavailable`),
    null
  )
}
