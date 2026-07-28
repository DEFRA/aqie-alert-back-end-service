import { describe, it, expect } from 'vitest'
import { router } from './router.js'

describe('router plugin', () => {
  it('has plugin name "router"', () => {
    expect(router.plugin.name).toBe('router')
  })

  it('register calls server.route with combined routes', () => {
    const routes = []
    const server = {
      route: (r) => routes.push(...r)
    }
    router.plugin.register(server, {})
    // health + 2 example + userRoutes — at least several routes registered
    expect(routes.length).toBeGreaterThan(0)
    // health route should be present
    expect(routes.some((r) => r.path === '/health')).toBe(true)
    // example routes should be present
    expect(routes.some((r) => r.path === '/example')).toBe(true)
  })
})
