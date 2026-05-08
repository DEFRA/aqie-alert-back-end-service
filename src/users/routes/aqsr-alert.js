import Boom from '@hapi/boom'
import { aqsrAlertHandler } from '../controllers/aqsrAlertController.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/

function validateCoordinates(lat, long) {
  if (lat == null || long == null) {
    throw Boom.badRequest('lat and long are required for current-day mode')
  }
  const parsedLat = Number(lat)
  const parsedLong = Number(long)
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLong)) {
    throw Boom.badRequest('lat and long must be valid numbers')
  }
  return { parsedLat, parsedLong }
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) {
    throw Boom.badRequest('Both start-date and end-date are required')
  }
  if (!DATE_FORMAT_REGEX.test(startDate) || !DATE_FORMAT_REGEX.test(endDate)) {
    throw Boom.badRequest(
      'start-date and end-date must be in yyyy-mm-dd format'
    )
  }
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw Boom.badRequest('start-date and end-date must be valid dates')
  }
  if (end < start) {
    throw Boom.badRequest('end-date must be on or after start-date')
  }
}

const aqsrAlert = {
  method: 'GET',
  path: '/aqsr-alert',
  options: {
    validate: {
      query: (value) => {
        logger.info(
          `Validating aqsr-alert query parameters ${JSON.stringify({
            lat: value.lat,
            long: value.long,
            'current-day': value['current-day'],
            'start-date': value['start-date'],
            'end-date': value['end-date']
          })}`
        )

        const currentDay =
          value['current-day'] === 'true' || value['current-day'] === true
        const startDate = value['start-date']
        const endDate = value['end-date']
        const hasDateRange = startDate != null || endDate != null

        if (!currentDay && !hasDateRange) {
          logger.warn('No mode parameter supplied')
          throw Boom.badRequest(
            'Provide either current-day=true with lat and long, or start-date and end-date'
          )
        }
        if (currentDay && hasDateRange) {
          logger.warn('Conflicting mode parameters supplied')
          throw Boom.badRequest(
            'Provide either current-day or start-date/end-date, not both'
          )
        }

        // Mode 1: lat + long + current-day=true
        if (currentDay) {
          const { parsedLat, parsedLong } = validateCoordinates(
            value.lat,
            value.long
          )
          logger.info(
            'Query parameter validation successful (current-day mode)'
          )
          return { lat: parsedLat, long: parsedLong, currentDay: true }
        }

        // Mode 2: start-date + end-date only
        validateDateRange(startDate, endDate)
        logger.info('Query parameter validation successful (date-range mode)')
        return { startDate, endDate }
      }
    }
  },
  handler: aqsrAlertHandler
}

export { aqsrAlert }
