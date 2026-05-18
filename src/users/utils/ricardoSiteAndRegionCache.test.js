import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('./ricardoApiClient.js', () => ({
  fetchSiteMetaData: vi.fn()
}))

vi.mock('./regionFinder.js', () => ({
  findRegion: vi.fn()
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

const SITE_ID_NW = 'UKA00170'
const SITE_ID_LONDON = 'UKA00339'
const SITE_ID_NEW = 'UKA00999'
const SITE_ID_UNKNOWN_REGION = 'UKA99999'

const REGION_NW = 'North West & Merseyside'
const REGION_LONDON = 'Greater London'

const LAT_NW = '53.46'
const LON_NW = '-2.47'
const LAT_LONDON = '51.5074'
const LON_LONDON = '-0.1278'

const STATION_NW = 'Manchester Piccadilly'
const STATION_LONDON = 'London Marylebone Road'

const TTL_24H_MS = 24 * 60 * 60 * 1000
const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000

const siteNW = { siteId: SITE_ID_NW, latitude: LAT_NW, longitude: LON_NW }
const siteNWWithName = {
  siteId: SITE_ID_NW,
  latitude: LAT_NW,
  longitude: LON_NW,
  siteName: STATION_NW
}
const siteLondon = {
  siteId: SITE_ID_LONDON,
  latitude: LAT_LONDON,
  longitude: LON_LONDON
}
const siteLondonWithName = {
  siteId: SITE_ID_LONDON,
  latitude: LAT_LONDON,
  longitude: LON_LONDON,
  siteName: STATION_LONDON
}

describe('ricardoSiteAndRegionCache', () => {
  let initSiteCache
  let stopSiteCache
  let getRegionForSite
  let getSiteIdsForRegion
  let getSiteInfo
  let mockFetchSiteMetaData
  let mockFindRegion

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()

    const mod = await import('./ricardoSiteAndRegionCache.js')
    initSiteCache = mod.initSiteCache
    stopSiteCache = mod.stopSiteCache
    getRegionForSite = mod.getRegionForSite
    getSiteIdsForRegion = mod.getSiteIdsForRegion
    getSiteInfo = mod.getSiteInfo

    mockFetchSiteMetaData = vi.mocked(
      (await import('./ricardoApiClient.js')).fetchSiteMetaData
    )
    mockFindRegion = vi.mocked((await import('./regionFinder.js')).findRegion)
  })

  afterEach(() => {
    stopSiteCache()
    vi.useRealTimers()
  })

  describe('getRegionForSite', () => {
    it('should return null when cache has not been initialised', () => {
      expect(getRegionForSite(SITE_ID_NW)).toBeNull()
    })

    it('should return null for unknown siteId after population', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getRegionForSite('UNKNOWN-SITE')).toBeNull()
    })

    it('should return region string for a known siteId', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getRegionForSite(SITE_ID_NW)).toBe(REGION_NW)
    })

    it('should return region string even when siteName is present in cache', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNWWithName] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getRegionForSite(SITE_ID_NW)).toBe(REGION_NW)
    })
  })

  describe('getSiteInfo', () => {
    it('should return null when cache has not been initialised', () => {
      expect(getSiteInfo(SITE_ID_NW)).toBeNull()
    })

    it('should return null for unknown siteId', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getSiteInfo('UNKNOWN-SITE')).toBeNull()
    })

    it('should return region and null monitoringStationName when siteName is absent', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getSiteInfo(SITE_ID_NW)).toEqual({
        region: REGION_NW,
        monitoringStationName: null
      })
    })

    it('should return region and monitoringStationName when siteName is present', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNWWithName] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getSiteInfo(SITE_ID_NW)).toEqual({
        region: REGION_NW,
        monitoringStationName: STATION_NW
      })
    })

    it('should return correct info for each of multiple populated sites', async () => {
      mockFetchSiteMetaData.mockResolvedValue({
        member: [siteNWWithName, siteLondonWithName]
      })
      mockFindRegion
        .mockReturnValueOnce(REGION_NW)
        .mockReturnValueOnce(REGION_LONDON)

      await initSiteCache()

      expect(getSiteInfo(SITE_ID_NW)).toEqual({
        region: REGION_NW,
        monitoringStationName: STATION_NW
      })
      expect(getSiteInfo(SITE_ID_LONDON)).toEqual({
        region: REGION_LONDON,
        monitoringStationName: STATION_LONDON
      })
    })
  })

  describe('getSiteIdsForRegion', () => {
    it('should return empty array when cache has not been initialised', () => {
      expect(getSiteIdsForRegion(REGION_NW)).toEqual([])
    })

    it('should return empty array for unknown region', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getSiteIdsForRegion('Unknown Region')).toEqual([])
    })

    it('should return siteId for a single matching region', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getSiteIdsForRegion(REGION_NW)).toEqual([SITE_ID_NW])
    })

    it('should return all siteIds for a region with multiple matching sites', async () => {
      const siteNW2 = {
        siteId: 'UKA00171',
        latitude: '53.50',
        longitude: '-2.50'
      }
      mockFetchSiteMetaData.mockResolvedValue({
        member: [siteNW, siteNW2, siteLondon]
      })
      mockFindRegion
        .mockReturnValueOnce(REGION_NW)
        .mockReturnValueOnce(REGION_NW)
        .mockReturnValueOnce(REGION_LONDON)

      await initSiteCache()

      const result = getSiteIdsForRegion(REGION_NW)
      expect(result).toHaveLength(2)
      expect(result).toContain(SITE_ID_NW)
      expect(result).toContain('UKA00171')
    })

    it('should not include siteIds from a different region', async () => {
      mockFetchSiteMetaData.mockResolvedValue({
        member: [siteNW, siteLondon]
      })
      mockFindRegion
        .mockReturnValueOnce(REGION_NW)
        .mockReturnValueOnce(REGION_LONDON)

      await initSiteCache()

      expect(getSiteIdsForRegion(REGION_NW)).toEqual([SITE_ID_NW])
      expect(getSiteIdsForRegion(REGION_LONDON)).toEqual([SITE_ID_LONDON])
    })
  })

  describe('initSiteCache', () => {
    it('should populate map and return correct region for known siteId', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(mockFindRegion).toHaveBeenCalledWith(
        parseFloat(LAT_NW),
        parseFloat(LON_NW)
      )
      expect(getRegionForSite(SITE_ID_NW)).toBe(REGION_NW)
    })

    it('should store monitoringStationName from siteName field', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNWWithName] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getSiteInfo(SITE_ID_NW)).toEqual({
        region: REGION_NW,
        monitoringStationName: STATION_NW
      })
    })

    it('should store null monitoringStationName when siteName is missing', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      expect(getSiteInfo(SITE_ID_NW)).toEqual({
        region: REGION_NW,
        monitoringStationName: null
      })
    })

    it('should populate multiple sites correctly', async () => {
      mockFetchSiteMetaData.mockResolvedValue({
        member: [siteNW, siteLondon]
      })
      mockFindRegion
        .mockReturnValueOnce(REGION_NW)
        .mockReturnValueOnce(REGION_LONDON)

      await initSiteCache()

      expect(getRegionForSite(SITE_ID_NW)).toBe(REGION_NW)
      expect(getRegionForSite(SITE_ID_LONDON)).toBe(REGION_LONDON)
    })

    it('should skip sites with missing siteId', async () => {
      mockFetchSiteMetaData.mockResolvedValue({
        member: [{ siteId: null, latitude: LAT_NW, longitude: LON_NW }]
      })

      await initSiteCache()

      expect(mockFindRegion).not.toHaveBeenCalled()
      expect(getRegionForSite(null)).toBeNull()
    })

    it('should skip sites with missing latitude', async () => {
      mockFetchSiteMetaData.mockResolvedValue({
        member: [{ siteId: SITE_ID_NW, latitude: null, longitude: LON_NW }]
      })

      await initSiteCache()

      expect(mockFindRegion).not.toHaveBeenCalled()
      expect(getRegionForSite(SITE_ID_NW)).toBeNull()
    })

    it('should skip sites with missing longitude', async () => {
      mockFetchSiteMetaData.mockResolvedValue({
        member: [{ siteId: SITE_ID_NW, latitude: LAT_NW, longitude: null }]
      })

      await initSiteCache()

      expect(mockFindRegion).not.toHaveBeenCalled()
      expect(getRegionForSite(SITE_ID_NW)).toBeNull()
    })

    it('should skip sites where findRegion returns Unknown', async () => {
      mockFetchSiteMetaData.mockResolvedValue({
        member: [
          { siteId: SITE_ID_UNKNOWN_REGION, latitude: '0', longitude: '0' }
        ]
      })
      mockFindRegion.mockReturnValue('Unknown')

      await initSiteCache()

      expect(getRegionForSite(SITE_ID_UNKNOWN_REGION)).toBeNull()
    })

    it('should handle fetchSiteMetaData failure without throwing', async () => {
      mockFetchSiteMetaData.mockRejectedValue(new Error('API unreachable'))

      await expect(initSiteCache()).resolves.not.toThrow()
      expect(getRegionForSite(SITE_ID_NW)).toBeNull()
    })

    it('should handle empty member array without throwing', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [] })

      await expect(initSiteCache()).resolves.not.toThrow()
    })

    it('should handle response without member property without throwing', async () => {
      mockFetchSiteMetaData.mockResolvedValue({})

      await expect(initSiteCache()).resolves.not.toThrow()
    })

    it('should mix valid and skipped sites correctly', async () => {
      mockFetchSiteMetaData.mockResolvedValue({
        member: [
          siteNW,
          { siteId: null, latitude: '51.5', longitude: '-0.1' },
          { siteId: SITE_ID_UNKNOWN_REGION, latitude: '0', longitude: '0' },
          siteLondon
        ]
      })
      mockFindRegion
        .mockReturnValueOnce(REGION_NW)
        .mockReturnValueOnce('Unknown')
        .mockReturnValueOnce(REGION_LONDON)

      await initSiteCache()

      expect(getRegionForSite(SITE_ID_NW)).toBe(REGION_NW)
      expect(getRegionForSite(SITE_ID_UNKNOWN_REGION)).toBeNull()
      expect(getRegionForSite(SITE_ID_LONDON)).toBe(REGION_LONDON)
    })
  })

  describe('TTL refresh', () => {
    it('should refresh cache automatically after 24 hours', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()
      expect(mockFetchSiteMetaData).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(TTL_24H_MS)

      expect(mockFetchSiteMetaData).toHaveBeenCalledTimes(2)
    })

    it('should pick up new siteId added by Ricardo after 24h refresh', async () => {
      const siteNew = {
        siteId: SITE_ID_NEW,
        latitude: '51.50',
        longitude: '-0.12'
      }

      mockFetchSiteMetaData
        .mockResolvedValueOnce({ member: [siteNW] })
        .mockResolvedValueOnce({ member: [siteNW, siteNew] })

      mockFindRegion
        .mockReturnValueOnce(REGION_NW)
        .mockReturnValueOnce(REGION_NW)
        .mockReturnValueOnce(REGION_LONDON)

      await initSiteCache()
      expect(getRegionForSite(SITE_ID_NEW)).toBeNull()

      await vi.advanceTimersByTimeAsync(TTL_24H_MS)

      expect(getRegionForSite(SITE_ID_NEW)).toBe(REGION_LONDON)
    })

    it('should preserve existing cache data when API is down during TTL refresh', async () => {
      mockFetchSiteMetaData.mockResolvedValueOnce({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()
      expect(getRegionForSite(SITE_ID_NW)).toBe(REGION_NW)

      mockFetchSiteMetaData.mockRejectedValueOnce(new Error('API unreachable'))

      await vi.advanceTimersByTimeAsync(TTL_24H_MS)

      expect(getRegionForSite(SITE_ID_NW)).toBe(REGION_NW)
    })

    it('should log the same error format when API is down during TTL refresh', async () => {
      mockFetchSiteMetaData.mockResolvedValueOnce({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()

      mockFetchSiteMetaData.mockRejectedValueOnce(new Error('Network timeout'))

      await vi.advanceTimersByTimeAsync(TTL_24H_MS)

      expect(mockLogger.error).toHaveBeenCalledWith(
        `[SiteCache] Failed to fetch site metadata ${JSON.stringify({ upstreamStatus: null, error: 'Network timeout' })}`
      )
    })

    it('should not trigger refresh before 24 hours have passed', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()
      expect(mockFetchSiteMetaData).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(TWENTY_THREE_HOURS_MS)

      expect(mockFetchSiteMetaData).toHaveBeenCalledTimes(1)
    })
  })

  describe('stopSiteCache', () => {
    it('should stop the refresh interval so no further refreshes occur', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [siteNW] })
      mockFindRegion.mockReturnValue(REGION_NW)

      await initSiteCache()
      stopSiteCache()

      await vi.advanceTimersByTimeAsync(TTL_24H_MS)

      expect(mockFetchSiteMetaData).toHaveBeenCalledTimes(1)
    })

    it('should not throw when called before initSiteCache', () => {
      expect(() => stopSiteCache()).not.toThrow()
    })

    it('should not throw when called multiple times', async () => {
      mockFetchSiteMetaData.mockResolvedValue({ member: [] })

      await initSiteCache()

      expect(() => {
        stopSiteCache()
        stopSiteCache()
      }).not.toThrow()
    })
  })
})
