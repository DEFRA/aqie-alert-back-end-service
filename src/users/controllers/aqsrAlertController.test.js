import { describe, it, expect, beforeEach, vi } from 'vitest'
import { aqsrAlertHandler } from './aqsrAlertController.js'

vi.mock('../utils/ricardoApiClient.js', () => ({
  fetchAlerts: vi.fn()
}))

vi.mock('../utils/regionFinder.js', () => ({
  findRegion: vi.fn()
}))

vi.mock('../utils/ricardoSiteAndRegionCache.js', () => ({
  getRegionForSite: vi.fn(),
  getSiteInfo: vi.fn(),
  getSiteCacheSize: vi.fn().mockReturnValue(1),
  ensureSiteCachePopulated: vi.fn().mockResolvedValue(true)
}))

vi.mock('../utils/pollutantAlertProcessor.js', () => ({
  formatPollutantName: vi.fn((p) => p),
  cleanPollutantName: vi.fn((p) => p),
  filterValidAlerts: vi.fn(),
  getMatchingUsers: vi.fn(),
  formatLocationForUrl: vi.fn(),
  getAlreadyProcessedAlertIds: vi.fn(),
  markAlertInProgress: vi.fn(),
  markAlertProcessed: vi.fn(),
  sendAlertToUser: vi.fn()
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('../utils/constants.js', () => ({
  STATUS_OK: 200
}))

const REGION = 'Yorkshire & Humber'
const SITE_ID_1 = 'UKA00353'
const SITE_ID_2 = 'UKA00412'

const recentDate = new Date(Date.now() - 60 * 60 * 1000).toISOString()
const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

function makeAlert(overrides = {}) {
  return {
    siteId: SITE_ID_1,
    samplingPointId: 1187,
    pollutant: 'O<sub>3</sub> (O3)',
    alertLevel: true,
    informationLevel: false,
    date: recentDate,
    ...overrides
  }
}

describe('aqsrAlertController', () => {
  let mockFetchAlerts
  let mockFindRegion
  let mockGetRegionForSite
  let mockGetSiteInfo
  let mockGetSiteCacheSize
  let mockEnsureSiteCachePopulated
  let mockH

  beforeEach(async () => {
    vi.clearAllMocks()

    mockFetchAlerts = vi.mocked(
      (await import('../utils/ricardoApiClient.js')).fetchAlerts
    )
    mockFindRegion = vi.mocked(
      (await import('../utils/regionFinder.js')).findRegion
    )
    mockGetRegionForSite = vi.mocked(
      (await import('../utils/ricardoSiteAndRegionCache.js')).getRegionForSite
    )
    mockGetSiteInfo = vi.mocked(
      (await import('../utils/ricardoSiteAndRegionCache.js')).getSiteInfo
    )
    mockGetSiteCacheSize = vi.mocked(
      (await import('../utils/ricardoSiteAndRegionCache.js')).getSiteCacheSize
    )
    mockEnsureSiteCachePopulated = vi.mocked(
      (await import('../utils/ricardoSiteAndRegionCache.js'))
        .ensureSiteCachePopulated
    )

    // Default to a healthy, populated cache. Tests exercising the
    // empty-cache path override these.
    mockGetSiteCacheSize.mockReturnValue(1)
    mockEnsureSiteCachePopulated.mockResolvedValue(true)

    // The two sample sites resolve to REGION; everything else (incl. unknown
    // siteIds) resolves to null so it can't match the requested region.
    mockGetRegionForSite.mockImplementation((siteId) =>
      siteId === SITE_ID_1 || siteId === SITE_ID_2 ? REGION : null
    )

    mockH = {
      response: vi.fn().mockReturnValue({ code: vi.fn().mockReturnValue({}) })
    }

    mockGetSiteInfo.mockReturnValue({
      region: REGION,
      monitoringStationName: 'Leeds Centre'
    })
  })

  function makeRequest(query) {
    return {
      headers: { 'x-request-id': 'test-req-id' },
      query
    }
  }

  describe('Mode 1 — currentDay=true', () => {
    it('should return empty array when region is Unknown', async () => {
      mockFindRegion.mockReturnValue('Unknown')

      await aqsrAlertHandler(
        makeRequest({ lat: 0, long: 0, currentDay: true }),
        mockH
      )

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should refresh an empty cache and serve results when refresh repopulates it', async () => {
      mockFindRegion.mockReturnValue(REGION)
      // Cache empty → on-demand refresh repopulates it.
      mockGetSiteCacheSize.mockReturnValue(0)
      mockEnsureSiteCachePopulated.mockResolvedValue(true)
      mockFetchAlerts.mockResolvedValue({ member: [makeAlert()] })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      expect(mockEnsureSiteCachePopulated).toHaveBeenCalled()
      expect(mockFetchAlerts).toHaveBeenCalled()
      // Proceeded past the empty-cache guard and returned the matching alert.
      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(1)
    })

    it('should return empty array when cache is empty and refresh fails', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockGetSiteCacheSize.mockReturnValue(0)
      mockEnsureSiteCachePopulated.mockResolvedValue(false)

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      expect(mockEnsureSiteCachePopulated).toHaveBeenCalled()
      expect(mockH.response).toHaveBeenCalledWith([])
      // Refresh failed → no Ricardo call.
      expect(mockFetchAlerts).not.toHaveBeenCalled()
    })

    it('should return 502 with null upstreamStatus when Ricardo throws without a status (network/timeout)', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockFetchAlerts.mockRejectedValue(new Error('Connection refused'))

      const result = await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBeNull()
    })

    it('should pass through 4xx with upstreamStatus when Ricardo returns a client error', async () => {
      mockFindRegion.mockReturnValue(REGION)
      const err = new Error('Unauthorized')
      err.status = 401
      mockFetchAlerts.mockRejectedValue(err)

      const result = await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(401)
      expect(result.output.payload.upstreamStatus).toBe(401)
    })

    it('should pass through 5xx with upstreamStatus when Ricardo returns a server error', async () => {
      mockFindRegion.mockReturnValue(REGION)
      const err = new Error('Service Unavailable')
      err.status = 503
      mockFetchAlerts.mockRejectedValue(err)

      const result = await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(503)
      expect(result.output.payload.upstreamStatus).toBe(503)
    })

    it('should fetch Ricardo with yesterday/today date range in current-day mode', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-15T12:00:00Z'))

      try {
        mockFindRegion.mockReturnValue(REGION)
        mockFetchAlerts.mockResolvedValue({ member: [] })

        await aqsrAlertHandler(
          makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
          mockH
        )

        expect(mockFetchAlerts).toHaveBeenCalledWith({
          startDate: '2026-05-14',
          endDate: '2026-05-15'
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('should return active alert entries when all three conditions pass', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({
            siteId: SITE_ID_1,
            samplingPointId: 1187,
            date: recentDate
          })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(1)
      expect(responseArg[0]['active-breaches']).toBe(true)
      expect(responseArg[0]['sampling-id']).toBe(1187)
      expect(responseArg[0].region).toBe(REGION)
      expect(responseArg[0]['monitoring-station-name']).toBe('Leeds Centre')
      expect(responseArg[0]['alert-started']).toBe(recentDate)
    })

    it('should set sampling-id to null when samplingPointId is missing from Ricardo response', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({
            siteId: SITE_ID_1,
            samplingPointId: undefined,
            date: recentDate
          })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg[0]['sampling-id']).toBeNull()
    })

    it('should return multiple entries when multiple alerts pass', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({
            siteId: SITE_ID_1,
            samplingPointId: 1001,
            date: recentDate
          }),
          makeAlert({
            siteId: SITE_ID_2,
            samplingPointId: 1002,
            pollutant: 'NO2',
            date: recentDate
          })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(2)
    })

    it('should return empty array when all alerts are older than 24h', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockFetchAlerts.mockResolvedValue({
        member: [makeAlert({ siteId: SITE_ID_1, date: oldDate })]
      })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should exclude alert when siteId is not in the region set', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockFetchAlerts.mockResolvedValue({
        member: [makeAlert({ siteId: 'UKA99999', date: recentDate })]
      })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should exclude alert when alertLevel and informationLevel are both false', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({
            siteId: SITE_ID_1,
            date: recentDate,
            alertLevel: false,
            informationLevel: false
          })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should include alert when only informationLevel is true', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({
            siteId: SITE_ID_1,
            date: recentDate,
            alertLevel: false,
            informationLevel: true
          })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(1)
      expect(responseArg[0]['active-breaches']).toBe(true)
    })

    it('should return empty array when Ricardo returns no members', async () => {
      mockFindRegion.mockReturnValue(REGION)
      mockFetchAlerts.mockResolvedValue({ member: [] })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should return entries sorted by date descending (newest first)', async () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      const fiveHoursAgo = new Date(
        Date.now() - 5 * 60 * 60 * 1000
      ).toISOString()
      const twentyHoursAgo = new Date(
        Date.now() - 20 * 60 * 60 * 1000
      ).toISOString()

      mockFindRegion.mockReturnValue(REGION) // Ricardo returns out-of-order to prove our sort kicks in
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({
            siteId: SITE_ID_1,
            samplingPointId: 2001,
            date: fiveHoursAgo
          }),
          makeAlert({
            siteId: SITE_ID_1,
            samplingPointId: 2002,
            date: oneHourAgo
          }),
          makeAlert({
            siteId: SITE_ID_1,
            samplingPointId: 2003,
            date: twentyHoursAgo
          })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ lat: 53.8, long: -1.5, currentDay: true }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(3)
      expect(responseArg[0]['alert-started']).toBe(oneHourAgo)
      expect(responseArg[1]['alert-started']).toBe(fiveHoursAgo)
      expect(responseArg[2]['alert-started']).toBe(twentyHoursAgo)
    })
  })

  describe('Mode 2 — startDate + endDate', () => {
    it('should return 502 with null upstreamStatus when Ricardo throws without a status (network/timeout)', async () => {
      mockFetchAlerts.mockRejectedValue(new Error('Timeout'))

      const result = await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBeNull()
    })

    it('should pass through 4xx with upstreamStatus when Ricardo returns a client error', async () => {
      const err = new Error('Forbidden')
      err.status = 403
      mockFetchAlerts.mockRejectedValue(err)

      const result = await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(403)
      expect(result.output.payload.upstreamStatus).toBe(403)
    })

    it('should pass through 5xx with upstreamStatus when Ricardo returns a server error', async () => {
      const err = new Error('Internal Server Error')
      err.status = 500
      mockFetchAlerts.mockRejectedValue(err)

      const result = await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(500)
      expect(result.output.payload.upstreamStatus).toBe(500)
    })

    it('should fetch Ricardo with correct start-date and end-date params', async () => {
      mockFetchAlerts.mockResolvedValue({ member: [] })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      expect(mockFetchAlerts).toHaveBeenCalledWith({
        startDate: '2024-12-01',
        endDate: '2025-08-13'
      })
    })

    it('should return empty array when Ricardo returns no members', async () => {
      mockFetchAlerts.mockResolvedValue({ member: [] })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should set active-breaches: true for alert within last 24h', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({
            siteId: SITE_ID_1,
            samplingPointId: 2345,
            date: recentDate
          })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(1)
      expect(responseArg[0]['active-breaches']).toBe(true)
      expect(responseArg[0]['sampling-id']).toBe(2345)
    })

    it('should set active-breaches: false for alert older than 24h', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [makeAlert({ siteId: SITE_ID_1, date: oldDate })]
      })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(1)
      expect(responseArg[0]['active-breaches']).toBe(false)
    })

    it('should return mix of active and historic alerts', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({ siteId: SITE_ID_1, date: recentDate }),
          makeAlert({ siteId: SITE_ID_2, date: oldDate })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(2)
      expect(responseArg[0]['active-breaches']).toBe(true)
      expect(responseArg[1]['active-breaches']).toBe(false)
    })

    it('should return entries sorted by date descending regardless of Ricardo order', async () => {
      const newest = '2025-08-13T17:00:00+01:00'
      const middle = '2025-07-11T19:00:00+01:00'
      const oldest = '2025-06-19T16:00:00+01:00'

      // Ricardo returns out-of-order to prove our sort kicks in
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({ siteId: SITE_ID_1, date: middle }),
          makeAlert({ siteId: SITE_ID_2, date: oldest }),
          makeAlert({ siteId: SITE_ID_1, date: newest })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(3)
      expect(responseArg[0]['alert-started']).toBe(newest)
      expect(responseArg[1]['alert-started']).toBe(middle)
      expect(responseArg[2]['alert-started']).toBe(oldest)
    })

    it('should exclude alerts where breach is not confirmed', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({
            siteId: SITE_ID_1,
            date: recentDate,
            alertLevel: false,
            informationLevel: false
          }),
          makeAlert({ siteId: SITE_ID_2, date: oldDate, alertLevel: true })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(1)
      expect(responseArg[0]['active-breaches']).toBe(false)
    })

    it('should not filter by region — includes alerts from all UK regions', async () => {
      mockGetSiteInfo
        .mockReturnValueOnce({
          region: 'Yorkshire & Humber',
          monitoringStationName: 'Leeds Centre'
        })
        .mockReturnValueOnce({
          region: 'London',
          monitoringStationName: 'London Marylebone Road'
        })

      mockFetchAlerts.mockResolvedValue({
        member: [
          makeAlert({ siteId: SITE_ID_1, date: recentDate }),
          makeAlert({ siteId: SITE_ID_2, date: oldDate })
        ]
      })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      expect(mockFindRegion).not.toHaveBeenCalled()
      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(2)
    })

    it('should populate monitoring-station-name and region from cache by siteId', async () => {
      mockGetSiteInfo.mockReturnValue({
        region: 'North West',
        monitoringStationName: 'Manchester Piccadilly'
      })
      mockFetchAlerts.mockResolvedValue({
        member: [makeAlert({ siteId: SITE_ID_1, date: recentDate })]
      })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg[0].region).toBe('North West')
      expect(responseArg[0]['monitoring-station-name']).toBe(
        'Manchester Piccadilly'
      )
    })

    it('should set monitoring-station-name to null when siteId not in cache', async () => {
      mockGetSiteInfo.mockReturnValue(null)
      mockFetchAlerts.mockResolvedValue({
        member: [makeAlert({ siteId: 'UNKNOWN', date: recentDate })]
      })

      await aqsrAlertHandler(
        makeRequest({ startDate: '2024-12-01', endDate: '2025-08-13' }),
        mockH
      )

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg[0]['monitoring-station-name']).toBeNull()
      expect(responseArg[0].region).toBeNull()
    })
  })
})
