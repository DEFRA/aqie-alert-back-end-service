import { describe, it, expect } from 'vitest'
import { pulse } from './pulse.js'

describe('pulse', () => {
  it('exports pulse with a plugin property', () => {
    expect(pulse).toBeDefined()
    expect(pulse.plugin).toBeDefined()
  })

  it('has options with a logger and a timeout', () => {
    expect(pulse.options).toBeDefined()
    expect(typeof pulse.options.timeout).toBe('number')
    expect(pulse.options.timeout).toBe(10000)
    expect(pulse.options.logger).toBeDefined()
  })
})
