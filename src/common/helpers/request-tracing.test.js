import { describe, it, expect } from 'vitest'
import { requestTracing } from './request-tracing.js'

describe('request-tracing', () => {
  it('exports requestTracing with a plugin property', () => {
    expect(requestTracing).toBeDefined()
    expect(requestTracing.plugin).toBeDefined()
  })

  it('has options with a tracingHeader', () => {
    expect(requestTracing.options).toBeDefined()
    expect(typeof requestTracing.options.tracingHeader).toBe('string')
  })
})
