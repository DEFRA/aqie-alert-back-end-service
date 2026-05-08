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

vi.mock('./opt-out-alert.js', () => ({
  optOutAlert: {
    method: 'DELETE',
    path: '/opt-out-sms-alert',
    handler: vi.fn()
  }
}))

vi.mock('./aqsr-alert.js', () => ({
  aqsrAlert: {
    method: 'GET',
    path: '/aqsr-alert',
    options: { validate: { query: vi.fn() } },
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

    it('should contain setup-alert, opt-out-alert and aqsr-alert routes', () => {
      expect(userRoutes).toHaveLength(4)
      expect(userRoutes[0]).toEqual({
        method: 'POST',
        path: '/setup-alert',
        handler: expect.any(Function)
      })
      expect(userRoutes[1]).toEqual({
        method: 'DELETE',
        path: '/opt-out-sms-alert',
        handler: expect.any(Function),
        options: {
          validate: {
            payload: expect.any(Function)
          }
        }
      })
      expect(userRoutes[2]).toEqual({
        method: 'DELETE',
        path: '/opt-out-email-alert',
        handler: expect.any(Function),
        options: {
          validate: {
            payload: expect.any(Function)
          }
        }
      })
      expect(userRoutes[3]).toEqual({
        method: 'GET',
        path: '/aqsr-alert',
        options: {
          validate: {
            query: expect.any(Function)
          }
        },
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
    it('should have exactly 4 routes', () => {
      expect(userRoutes).toHaveLength(4)
    })
  })
})
