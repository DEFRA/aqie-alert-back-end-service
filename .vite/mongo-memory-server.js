import { afterAll, beforeAll } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongoServer

beforeAll(async () => {
  // Setup mongo mock with increased timeout for Windows
  mongoServer = await MongoMemoryServer.create({
    binary: {
      version: '6.0.0',
      downloadDir: './mongodb-binaries'
    },
    instance: {
      port: 27017,
      dbName: 'test',
      launchTimeout: 120000 // 2 minutes
    }
  })

  const uri = mongoServer.getUri()
  process.env.MONGO_URI = uri
  globalThis.__MONGO_URI__ = uri
}, 150000) // 2.5 minute timeout

afterAll(async () => {
  if (mongoServer) {
    await mongoServer.stop()
  }
}, 30000)
