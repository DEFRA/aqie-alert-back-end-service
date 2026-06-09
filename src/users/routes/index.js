import { setupAlert } from './setup-alert.js'
import { optOutAlert } from './opt-out-sms-alert.js'
import { optOutEmailAlert } from './opt-out-email-alert.js'
import { aqsrAlert } from './aqsr-alert.js'
import { daqiAlert } from './daqi-alert.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

const userRoutes = [
  setupAlert,
  optOutAlert,
  optOutEmailAlert,
  aqsrAlert,
  daqiAlert
]

logger.info(
  `Initializing user routes ${JSON.stringify({ routeCount: userRoutes.length })}`
)

logger.info(
  `User routes configured successfully ${JSON.stringify({
    routes: userRoutes.map((route) => ({
      method: route.method,
      path: route.path
    }))
  })}`
)

export { userRoutes }
