import { describe, test, expect, vi } from 'vitest'

describe('#startServer', () => {
  let createServerSpy
  let startServerImport
  let createServerImport

  beforeAll(async () => {
    vi.stubEnv('PORT', '3098')
    createServerImport = await import('../../server.js')
    startServerImport = await import('./start-server.js')

    createServerSpy = vi.spyOn(createServerImport, 'createServer')
  })

  afterAll(() => {
    vi.resetAllMocks()
  })

  describe('When server starts', () => {
    test('Should start up server as expected', async () => {
      const mockServer = {
        start: vi.fn().mockResolvedValue(undefined),
        logger: { info: vi.fn() }
      }
      createServerSpy.mockResolvedValue(mockServer)

      await startServerImport.startServer()

      expect(createServerSpy).toHaveBeenCalled()
      expect(mockServer.start).toHaveBeenCalled()
    })
  })

  describe('When server start fails', () => {
    test('Should log failed startup message', async () => {
      createServerSpy.mockRejectedValue(new Error('Server failed to start'))

      await expect(startServerImport.startServer()).rejects.toThrow(
        'Server failed to start'
      )
    })
  })
})
