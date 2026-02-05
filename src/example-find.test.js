import { describe, it, expect, beforeEach, vi } from 'vitest'
import { findAllExampleData, findExampleData } from './example-find.js'

describe('example-find', () => {
  let mockDb
  let mockCollection
  let mockCursor

  beforeEach(() => {
    vi.clearAllMocks()

    mockCursor = {
      toArray: vi.fn()
    }

    mockCollection = {
      find: vi.fn(() => mockCursor),
      findOne: vi.fn()
    }

    mockDb = {
      collection: vi.fn(() => mockCollection)
    }
  })

  describe('findAllExampleData', () => {
    it('should find all example data with correct parameters', async () => {
      const mockData = [
        { exampleId: '1', name: 'Example 1', value: 'test1' },
        { exampleId: '2', name: 'Example 2', value: 'test2' }
      ]
      mockCursor.toArray.mockResolvedValue(mockData)

      const result = await findAllExampleData(mockDb)

      expect(mockDb.collection).toHaveBeenCalledWith('example-data')
      expect(mockCollection.find).toHaveBeenCalledWith(
        {},
        { projection: { _id: 0 } }
      )
      expect(mockCursor.toArray).toHaveBeenCalled()
      expect(result).toEqual(mockData)
    })

    it('should return empty array when no data exists', async () => {
      mockCursor.toArray.mockResolvedValue([])

      const result = await findAllExampleData(mockDb)

      expect(result).toEqual([])
    })

    it('should handle database errors', async () => {
      const dbError = new Error('Database connection failed')
      mockCursor.toArray.mockRejectedValue(dbError)

      await expect(findAllExampleData(mockDb)).rejects.toThrow(
        'Database connection failed'
      )
    })

    it('should use correct collection name', async () => {
      mockCursor.toArray.mockResolvedValue([])

      await findAllExampleData(mockDb)

      expect(mockDb.collection).toHaveBeenCalledWith('example-data')
    })

    it('should exclude _id field from results', async () => {
      mockCursor.toArray.mockResolvedValue([])

      await findAllExampleData(mockDb)

      expect(mockCollection.find).toHaveBeenCalledWith(
        {},
        { projection: { _id: 0 } }
      )
    })
  })

  describe('findExampleData', () => {
    it('should find specific example data by ID', async () => {
      const mockData = {
        exampleId: 'test-id',
        name: 'Test Example',
        value: 'test-value'
      }
      mockCollection.findOne.mockResolvedValue(mockData)

      const result = await findExampleData(mockDb, 'test-id')

      expect(mockDb.collection).toHaveBeenCalledWith('example-data')
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        { exampleId: 'test-id' },
        { projection: { _id: 0 } }
      )
      expect(result).toEqual(mockData)
    })

    it('should return null when data not found', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await findExampleData(mockDb, 'non-existent-id')

      expect(result).toBeNull()
    })

    it('should handle different ID types', async () => {
      const mockData = { exampleId: 123, name: 'Numeric ID Example' }
      mockCollection.findOne.mockResolvedValue(mockData)

      const result = await findExampleData(mockDb, 123)

      expect(mockCollection.findOne).toHaveBeenCalledWith(
        { exampleId: 123 },
        { projection: { _id: 0 } }
      )
      expect(result).toEqual(mockData)
    })

    it('should handle database errors', async () => {
      const dbError = new Error('Database query failed')
      mockCollection.findOne.mockRejectedValue(dbError)

      await expect(findExampleData(mockDb, 'test-id')).rejects.toThrow(
        'Database query failed'
      )
    })

    it('should use correct collection name', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      await findExampleData(mockDb, 'test-id')

      expect(mockDb.collection).toHaveBeenCalledWith('example-data')
    })

    it('should exclude _id field from result', async () => {
      mockCollection.findOne.mockResolvedValue({})

      await findExampleData(mockDb, 'test-id')

      expect(mockCollection.findOne).toHaveBeenCalledWith(expect.any(Object), {
        projection: { _id: 0 }
      })
    })

    it('should handle special characters in ID', async () => {
      const specialId = 'test-id-with-special-chars-@#$%'
      const mockData = { exampleId: specialId, name: 'Special ID Example' }
      mockCollection.findOne.mockResolvedValue(mockData)

      const result = await findExampleData(mockDb, specialId)

      expect(mockCollection.findOne).toHaveBeenCalledWith(
        { exampleId: specialId },
        { projection: { _id: 0 } }
      )
      expect(result).toEqual(mockData)
    })
  })

  describe('Database interaction', () => {
    it('should call collection method on database', async () => {
      mockCursor.toArray.mockResolvedValue([])
      mockCollection.findOne.mockResolvedValue(null)

      await findAllExampleData(mockDb)
      await findExampleData(mockDb, 'test-id')

      expect(mockDb.collection).toHaveBeenCalledTimes(2)
      expect(mockDb.collection).toHaveBeenCalledWith('example-data')
    })
  })
})
