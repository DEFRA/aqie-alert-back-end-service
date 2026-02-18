import { describe, it, expect, beforeEach, vi } from 'vitest'
import { optOutAlertHandler } from './optOutAlertController.js'

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn()
  })
}))

describe('optOutAlertHandler', () => {
  let mockRequest
  let mockH
  let mockDeleteOne

  beforeEach(() => {
    mockDeleteOne = vi.fn()

    mockRequest = {
      payload: { phoneNumber: '+447123456789' },
      db: {
        collection: vi.fn(() => ({
          deleteOne: mockDeleteOne
        }))
      }
    }

    mockH = {
      response: vi.fn((data) => ({
        code: vi.fn(() => data)
      }))
    }
  })

  it('should delete user and return success when user exists', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 })

    await optOutAlertHandler(mockRequest, mockH)

    expect(mockRequest.db.collection).toHaveBeenCalledWith('USERS')
    expect(mockDeleteOne).toHaveBeenCalledWith({
      user_contact: '+447123456789'
    })
    expect(mockH.response).toHaveBeenCalledWith({
      success: true,
      phoneNumber: '+447123456789'
    })
  })

  it('should return 404 when user not found', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 0 })

    await optOutAlertHandler(mockRequest, mockH)

    expect(mockH.response).toHaveBeenCalledWith({
      success: false,
      error: 'User not found'
    })
  })

  it('should handle database errors', async () => {
    mockDeleteOne.mockRejectedValue(new Error('DB error'))

    await optOutAlertHandler(mockRequest, mockH)

    expect(mockH.response).toHaveBeenCalledWith({
      success: false,
      error: 'Failed to opt-out'
    })
  })
})
