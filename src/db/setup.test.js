import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupDatabase } from './setup.js'

describe('setup', () => {
  let mockDb
  let mockCollection
  let consoleSpy

  beforeEach(() => {
    vi.clearAllMocks()

    mockCollection = {
      createIndex: vi.fn()
    }

    mockDb = {
      collection: vi.fn(() => mockCollection)
    }

    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {})
    }
  })

  afterEach(() => {
    consoleSpy.log.mockRestore()
    consoleSpy.error.mockRestore()
  })

  describe('setupDatabase', () => {
    it('should create unique index successfully', async () => {
      mockCollection.createIndex.mockResolvedValue({ acknowledged: true })

      await setupDatabase(mockDb)

      expect(mockDb.collection).toHaveBeenCalledWith('USERS')
      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { user_contact: 1 },
        { unique: true, name: 'user_contact_unique' }
      )
      expect(consoleSpy.log).toHaveBeenCalledWith(
        'Creating unique index for user_contact...'
      )
      expect(consoleSpy.log).toHaveBeenCalledWith(
        'Database setup completed successfully'
      )
    })

    it('should use correct collection name', async () => {
      mockCollection.createIndex.mockResolvedValue({ acknowledged: true })

      await setupDatabase(mockDb)

      expect(mockDb.collection).toHaveBeenCalledWith('USERS')
    })

    it('should create index with correct parameters', async () => {
      mockCollection.createIndex.mockResolvedValue({ acknowledged: true })

      await setupDatabase(mockDb)

      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { user_contact: 1 },
        { unique: true, name: 'user_contact_unique' }
      )
    })

    it('should handle index creation errors', async () => {
      const indexError = new Error('Index creation failed')
      mockCollection.createIndex.mockRejectedValue(indexError)

      await expect(setupDatabase(mockDb)).rejects.toThrow(
        'Index creation failed'
      )

      expect(consoleSpy.log).toHaveBeenCalledWith(
        'Creating unique index for user_contact...'
      )
      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Database setup failed:',
        indexError
      )
    })

    it('should handle duplicate index creation gracefully', async () => {
      const duplicateError = new Error('Index already exists')
      duplicateError.code = 85 // MongoDB duplicate index error code
      mockCollection.createIndex.mockRejectedValue(duplicateError)

      await expect(setupDatabase(mockDb)).rejects.toThrow(
        'Index already exists'
      )

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Database setup failed:',
        duplicateError
      )
    })

    it('should handle database connection errors', async () => {
      const connectionError = new Error('Database connection failed')
      mockDb.collection.mockImplementation(() => {
        throw connectionError
      })

      await expect(setupDatabase(mockDb)).rejects.toThrow(
        'Database connection failed'
      )

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Database setup failed:',
        connectionError
      )
    })

    it('should log setup progress', async () => {
      mockCollection.createIndex.mockResolvedValue({ acknowledged: true })

      await setupDatabase(mockDb)

      expect(consoleSpy.log).toHaveBeenCalledTimes(2)
      expect(consoleSpy.log).toHaveBeenNthCalledWith(
        1,
        'Creating unique index for user_contact...'
      )
      expect(consoleSpy.log).toHaveBeenNthCalledWith(
        2,
        'Database setup completed successfully'
      )
    })

    it('should handle undefined database', async () => {
      await expect(setupDatabase(undefined)).rejects.toThrow()

      expect(consoleSpy.error).toHaveBeenCalled()
    })

    it('should handle null database', async () => {
      await expect(setupDatabase(null)).rejects.toThrow()

      expect(consoleSpy.error).toHaveBeenCalled()
    })

    it('should create ascending index on user_contact', async () => {
      mockCollection.createIndex.mockResolvedValue({ acknowledged: true })

      await setupDatabase(mockDb)

      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { user_contact: 1 }, // 1 = ascending order
        expect.any(Object)
      )
    })

    it('should create unique index with specific name', async () => {
      mockCollection.createIndex.mockResolvedValue({ acknowledged: true })

      await setupDatabase(mockDb)

      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        expect.any(Object),
        { unique: true, name: 'user_contact_unique' }
      )
    })

    it('should handle MongoDB specific errors', async () => {
      const mongoError = new Error('MongoDB operation failed')
      mongoError.code = 11000 // MongoDB duplicate key error
      mockCollection.createIndex.mockRejectedValue(mongoError)

      await expect(setupDatabase(mockDb)).rejects.toThrow(
        'MongoDB operation failed'
      )

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Database setup failed:',
        mongoError
      )
    })
  })
})
