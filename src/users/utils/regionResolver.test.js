import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveRegionContext } from './regionResolver.js'

vi.mock('./regionFinder.js', () => ({
  findRegion: vi.fn()
}))

vi.mock('./ricardoSiteAndRegionCache.js', () => ({
  getSiteCacheSize: vi.fn().mockReturnValue(1),
  ensureSiteCachePopulated: vi.fn().mockResolvedValue(true)
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const ctx = { logPrefix: '[Test]', requestId: 'req-1' }

describe('resolveRegionContext', () => {
  let mockFindRegion
  let mockGetSiteCacheSize
  let mockEnsureSiteCachePopulated

  beforeEach(async () => {
    vi.clearAllMocks()
    mockFindRegion = vi.mocked((await import('./regionFinder.js')).findRegion)
    const cache = await import('./ricardoSiteAndRegionCache.js')
    mockGetSiteCacheSize = vi.mocked(cache.getSiteCacheSize)
    mockEnsureSiteCachePopulated = vi.mocked(cache.ensureSiteCachePopulated)

    mockGetSiteCacheSize.mockReturnValue(1)
    mockEnsureSiteCachePopulated.mockResolvedValue(true)
  })

  it('returns the region for valid coordinates with a healthy cache', async () => {
    mockFindRegion.mockReturnValue('Wales')

    const result = await resolveRegionContext(51.48, -3.18, ctx)

    expect(result).toEqual({ region: 'Wales' })
    expect(mockEnsureSiteCachePopulated).not.toHaveBeenCalled()
  })

  it('returns null when the region is Unknown (and does not touch the cache)', async () => {
    mockFindRegion.mockReturnValue('Unknown')

    const result = await resolveRegionContext(0, 0, ctx)

    expect(result).toBeNull()
    expect(mockGetSiteCacheSize).not.toHaveBeenCalled()
    expect(mockEnsureSiteCachePopulated).not.toHaveBeenCalled()
  })

  it('refreshes an empty cache and returns the region when repopulated', async () => {
    mockFindRegion.mockReturnValue('Wales')
    mockGetSiteCacheSize.mockReturnValue(0)
    mockEnsureSiteCachePopulated.mockResolvedValue(true)

    const result = await resolveRegionContext(51.48, -3.18, ctx)

    expect(mockEnsureSiteCachePopulated).toHaveBeenCalled()
    expect(result).toEqual({ region: 'Wales' })
  })

  it('returns null when the cache is empty and the refresh fails', async () => {
    mockFindRegion.mockReturnValue('Wales')
    mockGetSiteCacheSize.mockReturnValue(0)
    mockEnsureSiteCachePopulated.mockResolvedValue(false)

    const result = await resolveRegionContext(51.48, -3.18, ctx)

    expect(mockEnsureSiteCachePopulated).toHaveBeenCalled()
    expect(result).toBeNull()
  })
})
