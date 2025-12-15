import { afterAll, beforeAll } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongoServer

beforeAll(async () => {
  // Skip MongoDB Memory Server in CI environments
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    process.env.MONGO_URI = 'mongodb://localhost:27017/test'
    globalThis.__MONGO_URI__ = 'mongodb://localhost:27017/test'
    return
  }

  try {
    mongoServer = await MongoMemoryServer.create({
      binary: {
        version: '7.0.0',
        downloadDir: './mongodb-binaries',
        skipMD5: true
      },
      instance: {
        port: 27017,
        dbName: 'test',
        launchTimeout: 180000
      }
    })

    const uri = mongoServer.getUri()
    process.env.MONGO_URI = uri
    globalThis.__MONGO_URI__ = uri
  } catch (error) {
    console.error('Failed to start MongoDB Memory Server:', error)
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
