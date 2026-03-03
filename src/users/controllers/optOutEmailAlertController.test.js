import { optOutEmailAlertHandler } from './optOutEmailAlertController.js'
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('optOutEmailAlertHandler', () => {
  let mockDb, mockDeleteOne, mockH, codeSpy

  beforeEach(() => {
    mockDeleteOne = vi.fn()
    codeSpy = vi.fn()
    mockDb = {
      collection: vi.fn(() => ({
        deleteOne: mockDeleteOne
      }))
    }
    mockH = {
      response: vi.fn(() => ({
        code: codeSpy
      }))
    }
  })

  it('should delete user and return success when user exists', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 })
    const request = {
      payload: { emailAddress: 'test@example.com' },
      db: mockDb
    }

    await optOutEmailAlertHandler(request, mockH)
    expect(mockDeleteOne).toHaveBeenCalledWith({
      user_contact: 'test@example.com'
    })
    expect(mockH.response).toHaveBeenCalledWith({
      success: true,
      emailAddress: 'test@example.com'
    })
    expect(codeSpy).toHaveBeenCalledWith(200)
  })

  it('should return 404 when user not found', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 0 })
    const request = {
      payload: { emailAddress: 'notfound@example.com' },
      db: mockDb
    }

    await optOutEmailAlertHandler(request, mockH)
    expect(mockH.response).toHaveBeenCalledWith({
      success: false,
      error: 'User not found'
    })
    expect(codeSpy).toHaveBeenCalledWith(404)
  })

  it('should handle database errors', async () => {
    mockDeleteOne.mockRejectedValue(new Error('DB error'))
    const request = {
      payload: { emailAddress: 'error@example.com' },
      db: mockDb
    }

    await optOutEmailAlertHandler(request, mockH)
    expect(mockH.response).toHaveBeenCalledWith({
      success: false,
      error: 'Failed to opt-out-email'
    })
    expect(codeSpy).toHaveBeenCalledWith(500)
  })
})
