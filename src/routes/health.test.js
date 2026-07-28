import { describe, it, expect, vi } from 'vitest'
import { health } from './health.js'

describe('health route', () => {
  it('has method GET', () => {
    expect(health.method).toBe('GET')
  })

  it('has path /health', () => {
    expect(health.path).toBe('/health')
  })

  it('handler returns success response', () => {
    const mockH = { response: vi.fn((body) => body) }
    const result = health.handler({}, mockH)
    expect(result).toEqual({ message: 'success' })
    expect(mockH.response).toHaveBeenCalledWith({ message: 'success' })
  })
})
