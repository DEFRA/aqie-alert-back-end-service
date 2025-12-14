import { setupAlert } from './setup-alert.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

logger.info({ routeCount: 1 }, 'Initializing user routes')

const userRoutes = [setupAlert]

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
