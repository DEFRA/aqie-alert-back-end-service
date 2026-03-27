import { describe, it, expect, beforeEach, vi } from 'vitest'
import Boom from '@hapi/boom'
import { setupAlertHandler } from './setupAlertController.js'

// Mock all dependencies
vi.mock('../utils/notifyServiceClient.js', () => ({
  sendNotification: vi.fn()
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('../../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      const config = {
        'notification.templates.smsSetUpConfirmation': 'sms-template-id',
        'notification.templates.emailSetUpConfirmation': 'email-template-id',
        'notification.templates.unsubscribeEmailLink':
          'https://aqie-front-end.test.cdp-int.defra.cloud/notify/unsubscribe-email-link'
      }
      return config[key]
    })
  }
}))

vi.mock('../utils/validationUtils.js', () => ({
  normalizePhoneNumber: vi.fn((phone) => phone)
}))

vi.mock('../utils/regionFinder.js', () => ({
  findRegion: vi.fn(() => 'England')
}))

describe('setupAlertController', () => {
  let mockDb
  let mockCollection
  let mockRequest
  let mockH

  beforeEach(() => {
    vi.clearAllMocks()

    mockCollection = {
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      updateOne: vi.fn()
    }

    mockDb = {
      collection: vi.fn(() => mockCollection),
      databaseName: 'test-db'
    }

    mockRequest = {
      headers: {
        'x-request-id': 'test-request-id',
        'user-agent': 'test-agent'
      },
      info: { remoteAddress: '127.0.0.1' },
      payload: {
        phoneNumber: '07123456789',
        alertType: 'sms',
        location: 'London, City of Westminster',
        lat: 51.5074,
        long: -0.1278,
        lang: 'en'
      },
      db: mockDb
    }

    mockH = {
      response: vi.fn(() => ({
        code: vi.fn(() => ({ message: 'Alert setup successful' }))
      }))
    }
  })

  describe('Successful alert setup', () => {
    it('should create new SMS alert successfully', async () => {
      const { sendNotification } = await import(
        '../utils/notifyServiceClient.js'
      )

      mockCollection.findOne.mockResolvedValue(null)
      mockCollection.findOneAndUpdate.mockResolvedValue({
        _id: 'user-id-123',
        locations: [{ location: 'London, City of Westminster' }]
      })
      sendNotification.mockResolvedValue({ status: 'success' })

      await setupAlertHandler(mockRequest, mockH)

      expect(mockCollection.findOne).toHaveBeenCalledWith({
        user_contact: '07123456789'
      })
      expect(sendNotification).toHaveBeenCalledWith(
        {
          phoneNumber: '07123456789',
          emailAddress: undefined,
          templateId: 'sms-template-id',
          personalisation: { location: 'London, City of Westminster' }
        },
        'test-request-id'
      )
      expect(mockH.response).toHaveBeenCalledWith({
        message: 'Alert setup successful',
        userId: 'user-id-123'
      })
    })

    it('should include region in locationData stored to database', async () => {
      const { sendNotification } = await import(
        '../utils/notifyServiceClient.js'
      )
      const { findRegion } = await import('../utils/regionFinder.js')

      findRegion.mockReturnValue('England')
      mockCollection.findOne.mockResolvedValue(null)
      mockCollection.findOneAndUpdate.mockResolvedValue({
        _id: 'user-id-123',
        locations: [
          { location: 'London, City of Westminster', region: 'England' }
        ]
      })
      sendNotification.mockResolvedValue({ status: 'success' })

      await setupAlertHandler(mockRequest, mockH)

      expect(findRegion).toHaveBeenCalledWith(51.5074, -0.1278)
      const updateCall = mockCollection.findOneAndUpdate.mock.calls[0][1]
      expect(updateCall.$push.locations).toMatchObject({
        location: 'London, City of Westminster',
        region: 'England',
        coordinates: [-0.1278, 51.5074]
      })
      expect(updateCall.$set).toEqual({ lang: 'en' })
    })

    it('should default lang to en when not provided', async () => {
      const { sendNotification } = await import(
        '../utils/notifyServiceClient.js'
      )

      delete mockRequest.payload.lang

      mockCollection.findOne.mockResolvedValue(null)
      mockCollection.findOneAndUpdate.mockResolvedValue({
        _id: 'user-id-789',
        locations: [{ location: 'London, City of Westminster' }]
      })
      sendNotification.mockResolvedValue({ status: 'success' })

      await setupAlertHandler(mockRequest, mockH)

      const updateCall = mockCollection.findOneAndUpdate.mock.calls[0][1]
      expect(updateCall.$set).toEqual({ lang: 'en' })
    })

    it('should store lang cy when provided', async () => {
      const { sendNotification } = await import(
        '../utils/notifyServiceClient.js'
      )

      mockRequest.payload.lang = 'cy'

      mockCollection.findOne.mockResolvedValue(null)
      mockCollection.findOneAndUpdate.mockResolvedValue({
        _id: 'user-id-101',
        locations: [{ location: 'London, City of Westminster' }]
      })
      sendNotification.mockResolvedValue({ status: 'success' })

      await setupAlertHandler(mockRequest, mockH)

      const updateCall = mockCollection.findOneAndUpdate.mock.calls[0][1]
      expect(updateCall.$set).toEqual({ lang: 'cy' })
    })

    it('should create new email alert successfully', async () => {
      const { sendNotification } = await import(
        '../utils/notifyServiceClient.js'
      )

      mockRequest.payload = {
        emailAddress: 'test@example.com',
        alertType: 'email',
        location: 'Manchester, Greater Manchester',
        lat: 53.4808,
        long: -2.2426,
        lang: 'cy'
      }

      mockCollection.findOne.mockResolvedValue(null)
      mockCollection.findOneAndUpdate.mockResolvedValue({
        _id: 'user-id-456',
        locations: [{ location: 'Manchester, Greater Manchester' }]
      })
      sendNotification.mockResolvedValue({ status: 'success' })

      await setupAlertHandler(mockRequest, mockH)

      expect(sendNotification).toHaveBeenCalledWith(
        {
          phoneNumber: undefined,
          emailAddress: 'test@example.com',
          templateId: 'email-template-id',
          personalisation: {
            location: 'Manchester, Greater Manchester',
            unsubscribeLink:
              'https://aqie-front-end.test.cdp-int.defra.cloud/notify/unsubscribe-email-link?email=test%40example.com'
          }
        },
        'test-request-id'
      )
    })
  })

  describe('Validation errors', () => {
    it('should return error when database connection is not available', async () => {
      mockRequest.db = null

      const result = await setupAlertHandler(mockRequest, mockH)

      expect(result).toEqual(Boom.internal('Database connection error'))
    })

    it('should return error when database operation fails', async () => {
      const { sendNotification } = await import(
        '../utils/notifyServiceClient.js'
      )

      mockCollection.findOne.mockResolvedValue(null)
      mockCollection.findOneAndUpdate.mockResolvedValue(null)
      sendNotification.mockResolvedValue({ status: 'success' })

      const result = await setupAlertHandler(mockRequest, mockH)

      expect(result).toEqual(Boom.internal('Failed to process user data'))
    })
  })

  describe('Duplicate location detection', () => {
    it('should reject duplicate location (same case)', async () => {
      mockCollection.findOne.mockResolvedValue({
        _id: 'existing-user-id',
        user_contact: '07123456789',
        locations: [
          {
            location: 'London, City of Westminster',
            coordinates: [-0.1278, 51.5074]
          }
        ]
      })

      const result = await setupAlertHandler(mockRequest, mockH)

      expect(result).toEqual(
        Boom.conflict('Alert already exists for this location')
      )
      expect(mockCollection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('should reject duplicate location (different case)', async () => {
      mockCollection.findOne.mockResolvedValue({
        _id: 'existing-user-id',
        user_contact: '07123456789',
        locations: [
          {
            location: 'LONDON, CITY OF WESTMINSTER',
            coordinates: [-0.1278, 51.5074]
          }
        ]
      })

      const result = await setupAlertHandler(mockRequest, mockH)

      expect(result).toEqual(
        Boom.conflict('Alert already exists for this location')
      )
    })
  })

  describe('Location limit validation', () => {
    it('should reject when user has 5 locations already', async () => {
      mockCollection.findOne.mockResolvedValue({
        _id: 'existing-user-id',
        user_contact: '07123456789',
        locations: [
          { location: 'Location 1' },
          { location: 'Location 2' },
          { location: 'Location 3' },
          { location: 'Location 4' },
          { location: 'Location 5' }
        ]
      })

      const result = await setupAlertHandler(mockRequest, mockH)

      expect(result).toEqual(
        Boom.badRequest('Maximum 5 locations allowed per user')
      )
      expect(mockCollection.findOneAndUpdate).not.toHaveBeenCalled()
    })
  })

  describe('Notification service integration', () => {
    it('should return error when notification service fails', async () => {
      const { sendNotification } = await import(
        '../utils/notifyServiceClient.js'
      )

      mockCollection.findOne.mockResolvedValue(null)
      sendNotification.mockRejectedValue(
        new Error('Notification service unavailable')
      )

      const result = await setupAlertHandler(mockRequest, mockH)

      expect(result).toEqual(
        Boom.badGateway(
          'Alert setup failed - notification service unavailable or invalid contact details'
        )
      )
      expect(mockCollection.findOneAndUpdate).not.toHaveBeenCalled()
    })
  })

  describe('Database error handling', () => {
    it('should handle MongoDB duplicate key error', async () => {
      const { sendNotification } = await import(
        '../utils/notifyServiceClient.js'
      )

      mockCollection.findOne.mockResolvedValue(null)
      sendNotification.mockResolvedValue({ status: 'success' })

      const duplicateError = new Error('Duplicate key')
      duplicateError.code = 11000
      duplicateError.keyValue = { user_contact: '07123456789' }
      mockCollection.findOneAndUpdate.mockRejectedValue(duplicateError)

      const result = await setupAlertHandler(mockRequest, mockH)

      expect(result).toEqual(
        Boom.conflict('Location already exists for this user')
      )
    })

    it('should handle general database errors', async () => {
      const { sendNotification } = await import(
        '../utils/notifyServiceClient.js'
      )

      mockCollection.findOne.mockResolvedValue(null)
      sendNotification.mockResolvedValue({ status: 'success' })
      mockCollection.findOneAndUpdate.mockRejectedValue(
        new Error('Database connection failed')
      )

      const result = await setupAlertHandler(mockRequest, mockH)

      expect(result).toEqual(Boom.internal('Failed to setup alert'))
    })
  })
})
