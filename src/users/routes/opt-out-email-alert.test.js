import Boom from '@hapi/boom'
import { optOutEmailAlert } from './opt-out-email-alert.js'

const INVALID_EMAIL_FORMAT = 'Invalid email format'

describe('optOutEmailAlert route validation', () => {
  const validatePayload = optOutEmailAlert.options.validate.payload

  it('should pass validation for a valid email', () => {
    const payload = { emailAddress: 'test@example.com' }
    expect(validatePayload(payload)).toEqual(payload)
  })

  it('should throw BadRequest if emailAddress is missing', () => {
    expect(() => validatePayload({})).toThrow(
      Boom.badRequest('emailAddress is required')
    )
  })

  it('should throw BadRequest if emailAddress is not a string', () => {
    expect(() => validatePayload({ emailAddress: 12345 })).toThrow(
      Boom.badRequest('emailAddress is required')
    )
  })

  it('should throw Forbidden if emailAddress is invalid format', () => {
    expect(() => validatePayload({ emailAddress: 'invalid-email' })).toThrow(
      Boom.forbidden(INVALID_EMAIL_FORMAT)
    )
    // GDS-aligned regex: foo@bar (no dot in domain) is considered valid
    expect(() => validatePayload({ emailAddress: 'foo@bar.' })).toThrow(
      Boom.forbidden(INVALID_EMAIL_FORMAT)
    )
    expect(() => validatePayload({ emailAddress: 'foo@.com' })).toThrow(
      Boom.forbidden(INVALID_EMAIL_FORMAT)
    )
  })
})
