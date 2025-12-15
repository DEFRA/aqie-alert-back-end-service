import { afterAll, beforeAll } from 'vitest'
// Removed unused imports: setup, teardown

beforeAll(async () => {
  // Skip MongoDB setup - your service tests don't need it
  console.log('⚡ Skipping MongoDB Memory Server setup for better performance')

  // Set a dummy URI so tests don't fail
  process.env.MONGO_URI = 'mongodb://localhost:27017/test-db'

  // Uncomment when you need actual MongoDB integration tests
  /*
  import { setup } from 'vitest-mongodb'
  await setup({
    binary: {
      version: '6.0.0'
    },
    serverOptions: {},
    autoStart: true
  })
  process.env.MONGO_URI = globalThis.__MONGO_URI__
  */
}, 5000)

afterAll(async () => {
  console.log('⚡ Skipping MongoDB teardown')
  // Uncomment when you need actual MongoDB integration tests
  /*
  import { teardown } from 'vitest-mongodb'
  await teardown()
  */
})
