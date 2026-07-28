import { describe, it, expect } from 'vitest'
import { requestLogger } from './request-logger.js'

describe('request-logger', () => {
  it('exports requestLogger with a plugin property', () => {
    expect(requestLogger).toBeDefined()
    expect(requestLogger.plugin).toBeDefined()
  })

  it('has options with level property', () => {
    expect(requestLogger.options).toBeDefined()
    expect(typeof requestLogger.options.level).toBe('string')
  })
})
