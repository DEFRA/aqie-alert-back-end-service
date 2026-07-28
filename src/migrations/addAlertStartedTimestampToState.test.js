import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addAlertStartedTimestampToState } from './addAlertStartedTimestampToState.js'

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

function makeDb(pendingCount = 0, modifiedCount = 0) {
  const col = {
    countDocuments: vi.fn().mockResolvedValue(pendingCount),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount })
  }
  return { collection: vi.fn().mockReturnValue(col), _col: col }
}

describe('addAlertStartedTimestampToState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when no documents need migrating', async () => {
    const db = makeDb(0)
    await addAlertStartedTimestampToState(db)
    expect(db._col.updateMany).not.toHaveBeenCalled()
  })

  it('calls updateMany when there are documents to migrate', async () => {
    const db = makeDb(3, 3)
    await addAlertStartedTimestampToState(db)
    expect(db._col.updateMany).toHaveBeenCalledWith(
      {
        'alert-started-timestamp': { $exists: false },
        createdAt: { $exists: true }
      },
      [{ $set: { 'alert-started-timestamp': '$createdAt' } }]
    )
  })

  it('logs the number of documents migrated', async () => {
    const db = makeDb(2, 2)
    await expect(addAlertStartedTimestampToState(db)).resolves.not.toThrow()
  })

  it('throws and logs when updateMany rejects', async () => {
    const col = {
      countDocuments: vi.fn().mockResolvedValue(1),
      updateMany: vi.fn().mockRejectedValue(new Error('DB error'))
    }
    const db = { collection: vi.fn().mockReturnValue(col) }
    await expect(addAlertStartedTimestampToState(db)).rejects.toThrow(
      'DB error'
    )
  })

  it('throws and logs when countDocuments rejects', async () => {
    const col = {
      countDocuments: vi.fn().mockRejectedValue(new Error('Count failed'))
    }
    const db = { collection: vi.fn().mockReturnValue(col) }
    await expect(addAlertStartedTimestampToState(db)).rejects.toThrow(
      'Count failed'
    )
  })
})
