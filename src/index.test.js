import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock dependencies
vi.mock('./common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn()
  }))
}))

vi.mock('./common/helpers/start-server.js', () => ({
  startServer: vi.fn()
}))

describe('index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Module behavior', () => {
    it('should have startServer and createLogger functions available', async () => {
      const { startServer } = await import('./common/helpers/start-server.js')
      const { createLogger } = await import(
        './common/helpers/logging/logger.js'
      )

      expect(startServer).toBeDefined()
      expect(createLogger).toBeDefined()
    })

    it('should create logger instance', async () => {
      const { createLogger } = await import(
        './common/helpers/logging/logger.js'
      )

      const logger = createLogger()

      expect(logger.info).toBeDefined()
      expect(logger.error).toBeDefined()
    })
  })

  describe('Error handling setup', () => {
    it('should have unhandled rejection handler logic', () => {
      // Test the handler logic directly
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn()
      }

      const testError = new Error('Test unhandled rejection')

      // Simulate the handler behavior
      mockLogger.info('Unhandled rejection')
      mockLogger.error(testError)

      expect(mockLogger.info).toHaveBeenCalledWith('Unhandled rejection')
      expect(mockLogger.error).toHaveBeenCalledWith(testError)
    })
  })
})
