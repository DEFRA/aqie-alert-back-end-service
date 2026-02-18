import { setupAlert } from './setup-alert.js'
import { optOutAlert } from './opt-out-alert.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

const userRoutes = [setupAlert, optOutAlert]

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
