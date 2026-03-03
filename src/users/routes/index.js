import { setupAlert } from './setup-alert.js'
import { optOutAlert } from './opt-out-sms-alert.js'
import { optOutEmailAlert } from './opt-out-email-alert.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

const userRoutes = [setupAlert, optOutAlert, optOutEmailAlert]

logger.info({ routeCount: userRoutes.length }, 'Initializing user routes')

logger.info(
  {
    routes: userRoutes.map((route) => ({
      method: route.method,
      path: route.path
    }))
  },
  'User routes configured successfully'
)

export { userRoutes }
