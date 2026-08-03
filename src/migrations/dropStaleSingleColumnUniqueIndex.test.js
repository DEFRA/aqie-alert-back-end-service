import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dropStaleSingleColumnUniqueIndex } from './dropStaleSingleColumnUniqueIndex.js'

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

function makeCol(dropBehavior = 'success') {
  const col = {
    dropIndex: vi.fn()
  }
  if (dropBehavior === 'success') {
    col.dropIndex.mockResolvedValue({})
  } else if (dropBehavior === 'IndexNotFound-codeName') {
    col.dropIndex.mockRejectedValue({
      codeName: 'IndexNotFound',
      message: 'not found'
    })
  } else if (dropBehavior === 'IndexNotFound-code') {
    col.dropIndex.mockRejectedValue({ code: 27, message: 'not found' })
  } else if (dropBehavior === 'otherError') {
    col.dropIndex.mockRejectedValue(new Error('Unexpected DB error'))
  }
  return col
}

function makeDb(dropBehavior) {
  const col = makeCol(dropBehavior)
  return { collection: vi.fn().mockReturnValue(col), _col: col }
}

describe('dropStaleSingleColumnUniqueIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drops the index successfully and resolves', async () => {
    const db = makeDb('success')
    await expect(dropStaleSingleColumnUniqueIndex(db)).resolves.not.toThrow()
    expect(db._col.dropIndex).toHaveBeenCalledWith('alert-id_1')
  })

  it('resolves when index is not found (codeName: IndexNotFound)', async () => {
    const db = makeDb('IndexNotFound-codeName')
    await expect(dropStaleSingleColumnUniqueIndex(db)).resolves.not.toThrow()
  })

  it('resolves when index is not found (code: 27)', async () => {
    const db = makeDb('IndexNotFound-code')
    await expect(dropStaleSingleColumnUniqueIndex(db)).resolves.not.toThrow()
  })

  it('throws when dropIndex fails with unexpected error', async () => {
    const db = makeDb('otherError')
    await expect(dropStaleSingleColumnUniqueIndex(db)).rejects.toThrow(
      'Unexpected DB error'
    )
  })

  it('throws and logs on outer try-catch error', async () => {
    const col = {
      dropIndex: vi.fn().mockRejectedValue(new Error('Fatal error'))
    }
    const db = { collection: vi.fn().mockReturnValue(col) }
    await expect(dropStaleSingleColumnUniqueIndex(db)).rejects.toThrow(
      'Fatal error'
    )
  })
})
