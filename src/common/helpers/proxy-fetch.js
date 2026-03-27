import { proxyFetch } from './proxy/proxy.js'
import { createLogger } from '../helpers/logging/logger.js'
const logger = createLogger()

async function fetchWithProxy(url, options) {
  let statusCode
  try {
    const startTime = performance.now()
    const date = new Date().toUTCString()
    const response = await proxyFetch(url, options)
    const endTime = performance.now()
    const duration = endTime - startTime
    logger.info(
      `API response.status: ${response.status} from ${url} fetch took ${date} ${duration} milliseconds`
    )
    statusCode = response.status

    // For non-2xx responses, still try to parse JSON for error details
    if (!response.ok) {
      logger.warn(`Non-2xx response from ${url}: ${response.status}`)
      try {
        const errorData = await response.json()
        return [statusCode, errorData]
      } catch (parseError) {
        logger.error(
          `Failed to parse error response from ${url}: ${parseError.message}`
        )
        return [
          statusCode,
          { error: `HTTP ${response.status}`, message: response.statusText }
        ]
      }
    }

    const data = await response.json()
    return [statusCode, data]
  } catch (error) {
    logger.error(`Failed to proxyFetch data from ${url}: ${error.message}`)
    // Return a proper structure even for network errors
    return [0, { error: 'Network Error', message: error.message }]
  }
}

export { fetchWithProxy }
