import { describe, expect, it, vi } from 'vitest'
import { userRoutes } from './index.js'

// Mock dependencies
vi.mock('./setup-alert.js', () => ({
  setupAlert: {
    method: 'POST',
    path: '/setup-alert',
    handler: vi.fn()
  }
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('user routes index', () => {
  describe('Route aggregation', () => {
    it('should export userRoutes array', () => {
      expect(userRoutes).toBeDefined()
      expect(Array.isArray(userRoutes)).toBe(true)
    })

    it('should contain setup-alert route', () => {
      expect(userRoutes).toHaveLength(1)
      expect(userRoutes[0]).toEqual({
        method: 'POST',
        path: '/setup-alert',
        handler: expect.any(Function)
      })
    })

    it('should have correct route structure', () => {
      const route = userRoutes[0]
      expect(route.method).toBe('POST')
      expect(route.path).toBe('/setup-alert')
      expect(route.handler).toBeDefined()
    })
  })

  describe('Route count validation', () => {
    it('should have exactly 1 route', () => {
      expect(userRoutes).toHaveLength(1)
    })
  })
})
