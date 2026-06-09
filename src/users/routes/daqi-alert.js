import { daqiAlertHandler } from '../controllers/daqiAlertController.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

// GET /daqi-alert
// No request parameters — backend auto-computes start-date = yesterday and
// end-date = today (UK local date) when calling Ricardo's /api/daqi_alerts.
// Any query string supplied by the client is ignored.
const daqiAlert = {
  method: 'GET',
  path: '/daqi-alert',
  options: {
    description:
      'Returns active DAQI breach alerts (daqi >= threshold, validated, within last 24h)'
  },
  handler: (request, h) => {
    logger.info('daqi-alert request received')
    return daqiAlertHandler(request, h)
  }
}

export { daqiAlert }
