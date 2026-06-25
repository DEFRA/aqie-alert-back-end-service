import Boom from '@hapi/boom'
import { daqiAlertHandler } from '../controllers/daqiAlertController.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

function validateCoordinates(lat, long) {
  if (lat == null || long == null) {
    throw Boom.badRequest('lat and long are required')
  }
  const parsedLat = Number(lat)
  const parsedLong = Number(long)
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLong)) {
    throw Boom.badRequest('lat and long must be valid numbers')
  }
  return { parsedLat, parsedLong }
}

// GET /daqi-alert?lat=53.4&long=-2.2
// Region-scoped: the backend resolves the UK region from lat/long, then returns
// active DAQI breach alerts (daqi >= threshold, validated, within last 24h) for
// monitoring sites in that region. The 24h date window is auto-computed.
const daqiAlert = {
  method: 'GET',
  path: '/daqi-alert',
  options: {
    description:
      'Returns active DAQI breach alerts for the region resolved from lat/long (daqi >= threshold, validated, within last 24h)',
    validate: {
      query: (value) => {
        logger.info(
          `Validating daqi-alert query parameters ${JSON.stringify({
            lat: value.lat,
            long: value.long
          })}`
        )
        const { parsedLat, parsedLong } = validateCoordinates(
          value.lat,
          value.long
        )
        logger.info('daqi-alert query parameter validation successful')
        return { lat: parsedLat, long: parsedLong }
      }
    }
  },
  handler: daqiAlertHandler
}

export { daqiAlert }
