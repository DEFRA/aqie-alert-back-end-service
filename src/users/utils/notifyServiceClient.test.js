import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sendNotification } from './notifyServiceClient.js'

// Mock dependencies
vi.mock('undici', () => ({
  fetch: vi.fn()
}))

vi.mock('../../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'notification.serviceUrl')
        return 'http://localhost:3000/send-notification'
      return null
    })
  }
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('./maskingUtils.js', () => ({
  maskPhoneNumber: vi.fn((phone) => (phone ? '***' + phone.slice(-4) : phone)),
  maskEmail: vi.fn((email) => (email ? email.split('@')[0] + '@***' : email)),
  maskTemplateId: vi.fn((id) => (id ? '***' + id.slice(-4) : id))
}))

describe('notifyServiceClient', () => {
  let mockFetch
  let mockResponse

  beforeEach(async () => {
    vi.clearAllMocks()
    mockFetch = vi.mocked((await import('undici')).fetch)

    mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      text: vi.fn().mockResolvedValue('{"success": true}')
    }

    mockFetch.mockResolvedValue(mockResponse)
  })

  describe('Successful notifications', () => {
    it('should send SMS notification successfully', async () => {
      const payload = {
        phoneNumber: '07123456789',
        templateId: 'sms-template-id',
        personalisation: { location: 'London' }
      }

      const result = await sendNotification(payload, 'test-request-id')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/send-notification',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'test-request-id'
          },
          body: JSON.stringify(payload)
        }
      )
      expect(result).toBe(mockResponse)
    })

    it('should send email notification successfully', async () => {
      const payload = {
        emailAddress: 'test@example.com',
        templateId: 'email-template-id',
        personalisation: { location: 'Manchester' }
      }

      const result = await sendNotification(payload, 'test-request-id')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/send-notification',
        expect.objectContaining({
          body: JSON.stringify(payload)
        })
      )
      expect(result).toBe(mockResponse)
    })

    it('should generate request ID when not provided', async () => {
      const payload = {
        phoneNumber: '07123456789',
        templateId: 'template-id'
      }

      await sendNotification(payload)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-request-id': expect.stringMatching(/^notify-\d+-[a-z0-9]+$/)
          })
        })
      )
    })
  })

  describe('Error responses', () => {
    it('should handle 400 Bad Request', async () => {
      mockResponse.ok = false
      mockResponse.status = 400
      mockResponse.statusText = 'Bad Request'
      mockResponse.text.mockResolvedValue('Invalid payload')

      const payload = { phoneNumber: '123', templateId: 'invalid' }

      await expect(
        sendNotification(payload, 'test-request-id')
      ).rejects.toThrow('Notification service error: 400 - Invalid payload')
    })

    it('should handle 404 Not Found', async () => {
      mockResponse.ok = false
      mockResponse.status = 404
      mockResponse.statusText = 'Not Found'
      mockResponse.text.mockResolvedValue('Template not found')

      const payload = {
        phoneNumber: '07123456789',
        templateId: 'missing-template'
      }

      await expect(
        sendNotification(payload, 'test-request-id')
      ).rejects.toThrow('Notification service error: 404 - Template not found')
    })

    it('should handle 500 Internal Server Error', async () => {
      mockResponse.ok = false
      mockResponse.status = 500
      mockResponse.statusText = 'Internal Server Error'
      mockResponse.text.mockResolvedValue('Service unavailable')

      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }

      await expect(
        sendNotification(payload, 'test-request-id')
      ).rejects.toThrow('Notification service error: 500 - Service unavailable')
    })
  })

  describe('Network errors', () => {
    it('should handle connection refused error', async () => {
      const connectionError = new Error('Connection refused')
      connectionError.code = 'ECONNREFUSED'
      mockFetch.mockRejectedValue(connectionError)

      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }

      await expect(
        sendNotification(payload, 'test-request-id')
      ).rejects.toThrow('Connection refused')
    })

    it('should handle timeout error', async () => {
      const timeoutError = new Error('Request timeout')
      timeoutError.code = 'ETIMEDOUT'
      mockFetch.mockRejectedValue(timeoutError)

      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }

      await expect(
        sendNotification(payload, 'test-request-id')
      ).rejects.toThrow('Request timeout')
    })

    it('should handle unexpected network errors', async () => {
      const networkError = new Error('Network error')
      networkError.code = 'ENETWORK'
      mockFetch.mockRejectedValue(networkError)

      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }

      await expect(
        sendNotification(payload, 'test-request-id')
      ).rejects.toThrow('Network error')
    })
  })

  describe('Response parsing', () => {
    it('should handle valid JSON response', async () => {
      mockResponse.text.mockResolvedValue(
        '{"messageId": "msg-123", "status": "sent"}'
      )

      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }
      const result = await sendNotification(payload, 'test-request-id')

      expect(result).toBe(mockResponse)
    })

    it('should handle empty response body', async () => {
      mockResponse.text.mockResolvedValue('')

      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }
      const result = await sendNotification(payload, 'test-request-id')

      expect(result).toBe(mockResponse)
    })

    it('should handle invalid JSON response', async () => {
      mockResponse.text.mockResolvedValue('invalid json response')

      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }
      const result = await sendNotification(payload, 'test-request-id')

      expect(result).toBe(mockResponse)
    })

    it('should handle response text parsing error', async () => {
      mockResponse.text.mockRejectedValue(new Error('Failed to read response'))

      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }
      const result = await sendNotification(payload, 'test-request-id')

      expect(result).toBe(mockResponse)
    })
  })

  describe('Request configuration', () => {
    it('should set correct headers', async () => {
      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }

      await sendNotification(payload, 'custom-request-id')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'custom-request-id'
          }
        })
      )
    })

    it('should serialize payload correctly', async () => {
      const payload = {
        phoneNumber: '07123456789',
        templateId: 'template-id',
        personalisation: {
          location: 'London, City of Westminster',
          userName: 'Test User'
        }
      }

      await sendNotification(payload, 'test-request-id')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(payload)
        })
      )
    })

    it('should use configured service URL', async () => {
      const payload = { phoneNumber: '07123456789', templateId: 'template-id' }

      await sendNotification(payload, 'test-request-id')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/send-notification',
        expect.any(Object)
      )
    })
  })

  describe('Logging behavior', () => {
    it('should mask sensitive data in logs', async () => {
      const { maskPhoneNumber, maskEmail, maskTemplateId } = await import(
        './maskingUtils.js'
      )

      const payload = {
        phoneNumber: '07123456789',
        emailAddress: 'test@example.com',
        templateId: 'secret-template-id'
      }

      await sendNotification(payload, 'test-request-id')

      expect(maskPhoneNumber).toHaveBeenCalledWith('07123456789')
      expect(maskEmail).toHaveBeenCalledWith('test@example.com')
      expect(maskTemplateId).toHaveBeenCalledWith('secret-template-id')
    })
  })
})
