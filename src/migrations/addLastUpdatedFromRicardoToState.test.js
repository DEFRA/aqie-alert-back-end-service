import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addLastUpdatedFromRicardoToState } from './addLastUpdatedFromRicardoToState.js'

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

describe('addLastUpdatedFromRicardoToState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when no documents need migrating', async () => {
    const db = makeDb(0)
    await addLastUpdatedFromRicardoToState(db)
    expect(db._col.updateMany).not.toHaveBeenCalled()
  })

  it('calls updateMany with correct filter and update when documents need migrating', async () => {
    const db = makeDb(4, 4)
    await addLastUpdatedFromRicardoToState(db)
    expect(db._col.updateMany).toHaveBeenCalledWith(
      {
        lastUpdatedFromRicardo: { $exists: false },
        processedAt: { $exists: true }
      },
      [{ $set: { lastUpdatedFromRicardo: '$processedAt' } }]
    )
  })

  it('resolves without throwing when migration succeeds', async () => {
    const db = makeDb(5, 5)
    await expect(addLastUpdatedFromRicardoToState(db)).resolves.not.toThrow()
  })

  it('throws when updateMany rejects', async () => {
    const col = {
      countDocuments: vi.fn().mockResolvedValue(1),
      updateMany: vi.fn().mockRejectedValue(new Error('Write failed'))
    }
    const db = { collection: vi.fn().mockReturnValue(col) }
    await expect(addLastUpdatedFromRicardoToState(db)).rejects.toThrow(
      'Write failed'
    )
  })

  it('throws when countDocuments rejects', async () => {
    const col = {
      countDocuments: vi.fn().mockRejectedValue(new Error('Count error'))
    }
    const db = { collection: vi.fn().mockReturnValue(col) }
    await expect(addLastUpdatedFromRicardoToState(db)).rejects.toThrow(
      'Count error'
    )
  })
})
