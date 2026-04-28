import Boom from '@hapi/boom'
import { optOutEmailAlert } from './opt-out-email-alert.js'

const INVALID_EMAIL_FORMAT = 'Invalid email format'

describe('optOutEmailAlert route validation', () => {
  const validatePayload = optOutEmailAlert.options.validate.payload

  it('should pass validation for a valid email', () => {
    const payload = { emailAddress: 'test@example.com' }
    expect(validatePayload(payload)).toEqual(payload)
  })

  it('should normalize email to lowercase and trim whitespace', () => {
    expect(validatePayload({ emailAddress: 'User@Example.COM' })).toEqual({
      emailAddress: 'user@example.com'
    })
    expect(validatePayload({ emailAddress: '  test@domain.co.uk  ' })).toEqual({
      emailAddress: 'test@domain.co.uk'
    })
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

  it('should throw BadRequest if emailAddress is invalid format', () => {
    expect(() => validatePayload({ emailAddress: 'invalid-email' })).toThrow(
      Boom.badRequest(INVALID_EMAIL_FORMAT)
    )
    // GDS-aligned regex: foo@bar (no dot in domain) is considered valid
    expect(() => validatePayload({ emailAddress: 'foo@bar.' })).toThrow(
      Boom.badRequest(INVALID_EMAIL_FORMAT)
    )
    expect(() => validatePayload({ emailAddress: 'foo@.com' })).toThrow(
      Boom.badRequest(INVALID_EMAIL_FORMAT)
    )
  })
})
