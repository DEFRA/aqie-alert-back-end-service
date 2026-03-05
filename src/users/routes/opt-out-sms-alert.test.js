import { describe, it, expect, vi } from 'vitest'
import { optOutAlert } from './opt-out-sms-alert.js'

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn()
  })
}))

describe('optOutAlert route', () => {
  it('should have correct method and path', () => {
    expect(optOutAlert.method).toBe('DELETE')
    expect(optOutAlert.path).toBe('/opt-out-sms-alert')
  })

  it('should validate phoneNumber is required', () => {
    const validate = optOutAlert.options.validate.payload

    expect(() => validate({})).toThrow('phoneNumber is required')
    expect(() => validate({ phoneNumber: null })).toThrow(
      'phoneNumber is required'
    )
    expect(() => validate({ phoneNumber: 123 })).toThrow(
      'phoneNumber is required'
    )
  })

  it('should accept valid phoneNumber', () => {
    const validate = optOutAlert.options.validate.payload
    const payload = { phoneNumber: '+447123456789' }

    expect(validate(payload)).toEqual(payload)
  })
})
