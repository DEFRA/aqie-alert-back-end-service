import { afterAll, beforeAll } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongoServer

beforeAll(async () => {
  try {
    // Setup mongo mock with increased timeout and CI-friendly configuration
    mongoServer = await MongoMemoryServer.create({
      binary: {
        version: '7.0.0', // Use newer version for better compatibility
        downloadDir: './mongodb-binaries',
        skipMD5: true // Skip MD5 check for faster CI builds
      },
      instance: {
        port: 27017,
        dbName: 'test',
        launchTimeout: 180000 // 3 minutes for CI environments
      }
    })

    const uri = mongoServer.getUri()
    process.env.MONGO_URI = uri
    globalThis.__MONGO_URI__ = uri
  } catch (error) {
    console.error('Failed to start MongoDB Memory Server:', error)
    // Set a fallback URI for tests that don't require actual MongoDB
    process.env.MONGO_URI = 'mongodb://localhost:27017/test'
    globalThis.__MONGO_URI__ = 'mongodb://localhost:27017/test'
  }
}, 200000) // 3.3 minute timeout

afterAll(async () => {
  if (mongoServer) {
    try {
      await mongoServer.stop()
    } catch (error) {
      console.error('Error stopping MongoDB Memory Server:', error)
    }
  }
}, 30000)
