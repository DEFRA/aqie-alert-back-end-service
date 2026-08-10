import { describe, it, expect } from 'vitest'
import { mapUpstreamError } from './upstreamErrorMapper.js'

function buildUpstreamError(status, message = 'upstream failed') {
  const err = new Error(message)
  if (status != null) {
    err.status = status
  }
  return err
}

describe('mapUpstreamError', () => {
  describe('4xx client errors', () => {
    it('should preserve 400 status and set "rejected the request" message', () => {
      const result = mapUpstreamError(buildUpstreamError(400), 'Test service')

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(400)
      expect(result.message).toBe('Test service rejected the request')
      expect(result.output.payload.upstreamStatus).toBe(400)
    })

    it('should preserve 401 status', () => {
      const result = mapUpstreamError(buildUpstreamError(401), 'Test service')
      expect(result.output.statusCode).toBe(401)
      expect(result.output.payload.upstreamStatus).toBe(401)
    })

    it('should preserve 403 status', () => {
      const result = mapUpstreamError(buildUpstreamError(403), 'Test service')
      expect(result.output.statusCode).toBe(403)
      expect(result.output.payload.upstreamStatus).toBe(403)
    })

    it('should preserve 404 status', () => {
      const result = mapUpstreamError(buildUpstreamError(404), 'Test service')
      expect(result.output.statusCode).toBe(404)
      expect(result.output.payload.upstreamStatus).toBe(404)
    })

    it('should preserve 429 status', () => {
      const result = mapUpstreamError(buildUpstreamError(429), 'Test service')
      expect(result.output.statusCode).toBe(429)
      expect(result.output.payload.upstreamStatus).toBe(429)
    })
  })

  describe('5xx server errors', () => {
    it('should preserve 500 status and set "upstream error" message', () => {
      const result = mapUpstreamError(buildUpstreamError(500), 'Test service')

      expect(result.output.statusCode).toBe(500)
      expect(result.message).toBe('Test service upstream error')
      expect(result.output.payload.upstreamStatus).toBe(500)
    })

    it('should preserve 502 status', () => {
      const result = mapUpstreamError(buildUpstreamError(502), 'Test service')
      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBe(502)
    })

    it('should preserve 503 status', () => {
      const result = mapUpstreamError(buildUpstreamError(503), 'Test service')
      expect(result.output.statusCode).toBe(503)
      expect(result.output.payload.upstreamStatus).toBe(503)
    })

    it('should preserve 504 status', () => {
      const result = mapUpstreamError(buildUpstreamError(504), 'Test service')
      expect(result.output.statusCode).toBe(504)
      expect(result.output.payload.upstreamStatus).toBe(504)
    })

    it('should preserve 599 status (top of range)', () => {
      const result = mapUpstreamError(buildUpstreamError(599), 'Test service')
      expect(result.output.statusCode).toBe(599)
      expect(result.output.payload.upstreamStatus).toBe(599)
    })
  })

  describe('Fallback to 502', () => {
    it('should return 502 with upstreamStatus=null when error has no status', () => {
      const result = mapUpstreamError(new Error('ECONNREFUSED'), 'Test service')

      expect(result.output.statusCode).toBe(502)
      expect(result.message).toBe('Test service temporarily unavailable')
      expect(result.output.payload.upstreamStatus).toBeNull()
    })

    it('should return 502 when status is outside 4xx-5xx range (e.g. 3xx)', () => {
      const result = mapUpstreamError(buildUpstreamError(302), 'Test service')

      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBeNull()
    })

    it('should return 502 when status is below 400', () => {
      const result = mapUpstreamError(buildUpstreamError(200), 'Test service')

      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBeNull()
    })

    it('should return 502 when status is above 599', () => {
      const result = mapUpstreamError(buildUpstreamError(600), 'Test service')

      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBeNull()
    })

    it('should return 502 when status is non-numeric', () => {
      const result = mapUpstreamError(
        buildUpstreamError('not-a-number'),
        'Test service'
      )

      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBeNull()
    })

    it('should return 502 when err is null', () => {
      const result = mapUpstreamError(null, 'Test service')
      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBeNull()
    })
  })

  describe('Service name in messages', () => {
    it.each([
      ['4xx message', () => buildUpstreamError(401), 'rejected the request'],
      ['5xx message', () => buildUpstreamError(500), 'upstream error'],
      [
        '502 fallback message',
        () => new Error('boom'),
        'temporarily unavailable'
      ]
    ])('should include the service name in %s', (_label, buildErr, suffix) => {
      const result = mapUpstreamError(buildErr(), 'Custom Service Name')
      expect(result.message).toBe(`Custom Service Name ${suffix}`)
    })
  })
})
