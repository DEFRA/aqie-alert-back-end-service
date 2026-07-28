import { describe, it, expect, vi } from 'vitest'

vi.mock('../example-find.js', () => ({
  findAllExampleData: vi.fn(),
  findExampleData: vi.fn()
}))

const { findAllExampleData, findExampleData } = await import(
  '../example-find.js'
)
const { example } = await import('./example.js')

describe('example routes', () => {
  const mockH = { response: vi.fn((body) => body) }
  const mockDb = {}

  describe('GET /example', () => {
    const route = example.find((r) => r.path === '/example')

    it('returns success with entities', async () => {
      const entities = [{ id: 1 }]
      findAllExampleData.mockResolvedValue(entities)
      const request = { db: mockDb }
      const result = await route.handler(request, mockH)
      expect(result).toEqual({ message: 'success', entities })
    })
  })

  describe('GET /example/{exampleId}', () => {
    const route = example.find((r) => r.path === '/example/{exampleId}')

    it('returns success with entity when found', async () => {
      const entity = { id: '42', name: 'Test' }
      findExampleData.mockResolvedValue(entity)
      const request = { db: mockDb, params: { exampleId: '42' } }
      const result = await route.handler(request, mockH)
      expect(result).toEqual({ message: 'success', entity })
    })

    it('returns Boom 404 when entity not found', async () => {
      findExampleData.mockResolvedValue(null)
      const request = { db: mockDb, params: { exampleId: 'missing' } }
      const result = await route.handler(request, mockH)
      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(404)
    })
  })
})
