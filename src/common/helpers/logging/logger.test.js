import { describe, it, expect } from 'vitest'
import { createLogger } from './logger.js'

describe('logger', () => {
  it('createLogger returns an object with standard logging methods', () => {
    const logger = createLogger()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })

  it('createLogger returns the same singleton logger on repeated calls', () => {
    const l1 = createLogger()
    const l2 = createLogger()
    expect(l1).toBe(l2)
  })
})
