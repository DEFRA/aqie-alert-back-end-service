import Boom from '@hapi/boom'
import { optOutEmailAlert } from './opt-out-email-alert.js'

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
      Boom.forbidden('Invalid email format')
    )
    expect(() => validatePayload({ emailAddress: 'foo@bar' })).toThrow(
      Boom.forbidden('Invalid email format')
    )
    expect(() => validatePayload({ emailAddress: 'foo@bar.' })).toThrow(
      Boom.forbidden('Invalid email format')
    )
    expect(() => validatePayload({ emailAddress: 'foo@.com' })).toThrow(
      Boom.forbidden('Invalid email format')
    )
  })
})
