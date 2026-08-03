import { describe, it, expect } from 'vitest'
import { loggerOptions } from './logger-options.js'

describe('logger-options', () => {
  it('exports loggerOptions as an object', () => {
    expect(typeof loggerOptions).toBe('object')
    expect(loggerOptions).not.toBeNull()
  })

  it('has an enabled property', () => {
    expect('enabled' in loggerOptions).toBe(true)
  })

  it('has a level property', () => {
    expect(typeof loggerOptions.level).toBe('string')
  })

  it('has a redact object with paths array', () => {
    expect(loggerOptions.redact).toBeDefined()
    expect(Array.isArray(loggerOptions.redact.paths)).toBe(true)
  })

  it('has a mixin function', () => {
    expect(typeof loggerOptions.mixin).toBe('function')
  })

  it('mixin returns an object (no trace id in test)', () => {
    const result = loggerOptions.mixin()
    expect(typeof result).toBe('object')
  })
})
