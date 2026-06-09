import { describe, it, expect, beforeEach, vi } from 'vitest'
import { daqiAlertHandler } from './daqiAlertController.js'

vi.mock('../utils/ricardoApiClient.js', () => ({
  fetchDaqiAlerts: vi.fn()
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

vi.mock('../../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'metOfficeForecast.daqiAlertThreshold') return 7
      return null
    })
  }
}))

vi.mock('../utils/constants.js', () => ({
  STATUS_OK: 200
}))

const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

function makeDaqiAlert(overrides = {}) {
  return {
    id: 7716220260528,
    samplingPointId: 77162,
    siteId: 'UKA00819',
    region: 'Wales',
    daqi: 7,
    level: 'High',
    pollutant: 'O<sub>3</sub> (O3)',
    validationStatus: 2,
    date: recentDate,
    ...overrides
  }
}

describe('daqiAlertController', () => {
  let mockFetchDaqiAlerts
  let mockH

  beforeEach(async () => {
    vi.clearAllMocks()

    mockFetchDaqiAlerts = vi.mocked(
      (await import('../utils/ricardoApiClient.js')).fetchDaqiAlerts
    )

    mockH = {
      response: vi.fn().mockReturnValue({ code: vi.fn().mockReturnValue({}) })
    }
  })

  const request = {
    headers: { 'x-request-id': 'test-req-id' },
    query: {}
  }

  describe('Ricardo call with auto-computed dates', () => {
    it('should call fetchDaqiAlerts with startDate=yesterday, endDate=today (yyyy-mm-dd)', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({ member: [] })

      await daqiAlertHandler(request, mockH)

      expect(mockFetchDaqiAlerts).toHaveBeenCalledTimes(1)
      const callArgs = mockFetchDaqiAlerts.mock.calls[0][0]
      expect(callArgs.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(callArgs.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(callArgs.endDate).getTime()).toBeGreaterThanOrEqual(
        new Date(callArgs.startDate).getTime()
      )
    })

    it('should ignore any query params supplied on the request', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({ member: [] })

      await daqiAlertHandler(
        {
          headers: { 'x-request-id': 'test-req-id' },
          query: {
            startDate: '2020-01-01',
            endDate: '2020-12-31',
            'start-date': '2020-01-01',
            'end-date': '2020-12-31'
          }
        },
        mockH
      )

      const callArgs = mockFetchDaqiAlerts.mock.calls[0][0]
      expect(callArgs.startDate).not.toBe('2020-01-01')
      expect(callArgs.endDate).not.toBe('2020-12-31')
      expect(callArgs.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(callArgs.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('Empty responses', () => {
    it('should return [] when Ricardo returns no members', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({ member: [] })

      await daqiAlertHandler(request, mockH)

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should return [] when Ricardo response has no member property', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({})

      await daqiAlertHandler(request, mockH)

      expect(mockH.response).toHaveBeenCalledWith([])
    })
  })

  describe('Filter logic — daqi >= 7, validationStatus === 2, within 24h', () => {
    it('should include alert when all three conditions pass', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [
          makeDaqiAlert({
            daqi: 7,
            validationStatus: 2,
            date: recentDate
          })
        ]
      })

      await daqiAlertHandler(request, mockH)

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(1)
      expect(responseArg[0]).toEqual({
        'active-breaches': true,
        'pollutant-name': 'O<sub>3</sub> (O3)',
        daqi: 7,
        samplingPointId: 77162,
        siteId: 'UKA00819',
        'alert-started': recentDate
      })
    })

    it('should exclude alert when daqi < 7', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [makeDaqiAlert({ daqi: 6 })]
      })

      await daqiAlertHandler(request, mockH)

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should include alert when daqi > 7', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [makeDaqiAlert({ daqi: 10 })]
      })

      await daqiAlertHandler(request, mockH)

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(1)
      expect(responseArg[0].daqi).toBe(10)
    })

    it('should exclude alert when validationStatus is not 2', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [makeDaqiAlert({ validationStatus: 1 })]
      })

      await daqiAlertHandler(request, mockH)

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should exclude alert when date is older than 24h', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [makeDaqiAlert({ date: oldDate })]
      })

      await daqiAlertHandler(request, mockH)

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should exclude alert when daqi is missing', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [makeDaqiAlert({ daqi: undefined })]
      })

      await daqiAlertHandler(request, mockH)

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should exclude alert when daqi is a non-numeric string', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [makeDaqiAlert({ daqi: 'high' })]
      })

      await daqiAlertHandler(request, mockH)

      expect(mockH.response).toHaveBeenCalledWith([])
    })

    it('should include only the alerts that pass all filters when mixed records are returned', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [
          makeDaqiAlert({ daqi: 8, samplingPointId: 1, date: recentDate }),
          makeDaqiAlert({ daqi: 3, samplingPointId: 2, date: recentDate }),
          makeDaqiAlert({ validationStatus: 1, samplingPointId: 3 }),
          makeDaqiAlert({ samplingPointId: 4, date: oldDate }),
          makeDaqiAlert({ daqi: 9, samplingPointId: 5, date: recentDate })
        ]
      })

      await daqiAlertHandler(request, mockH)

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(2)
      const samplingPoints = responseArg.map((r) => r.samplingPointId)
      expect(samplingPoints).toContain(1)
      expect(samplingPoints).toContain(5)
    })
  })

  describe('Response shape (no monitoring-station-name)', () => {
    it('should not include monitoring-station-name in any response object', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [makeDaqiAlert()]
      })

      await daqiAlertHandler(request, mockH)

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg[0]).not.toHaveProperty('monitoring-station-name')
    })

    it('should set samplingPointId to null when missing from Ricardo response', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [makeDaqiAlert({ samplingPointId: undefined })]
      })

      await daqiAlertHandler(request, mockH)

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg[0].samplingPointId).toBeNull()
    })

    it('should set siteId to null when missing from Ricardo response', async () => {
      mockFetchDaqiAlerts.mockResolvedValue({
        member: [makeDaqiAlert({ siteId: undefined })]
      })

      await daqiAlertHandler(request, mockH)

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg[0].siteId).toBeNull()
    })
  })

  describe('Sorting — newest first', () => {
    it('should return entries sorted by date descending regardless of Ricardo order', async () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      const fiveHoursAgo = new Date(
        Date.now() - 5 * 60 * 60 * 1000
      ).toISOString()
      const twentyHoursAgo = new Date(
        Date.now() - 20 * 60 * 60 * 1000
      ).toISOString()

      mockFetchDaqiAlerts.mockResolvedValue({
        member: [
          makeDaqiAlert({ samplingPointId: 'mid', date: fiveHoursAgo }),
          makeDaqiAlert({ samplingPointId: 'old', date: twentyHoursAgo }),
          makeDaqiAlert({ samplingPointId: 'new', date: oneHourAgo })
        ]
      })

      await daqiAlertHandler(request, mockH)

      const responseArg = mockH.response.mock.calls[0][0]
      expect(responseArg).toHaveLength(3)
      expect(responseArg[0].samplingPointId).toBe('new')
      expect(responseArg[1].samplingPointId).toBe('mid')
      expect(responseArg[2].samplingPointId).toBe('old')
    })
  })

  describe('Upstream error passthrough', () => {
    it('should return 4xx when Ricardo responds with a client error', async () => {
      const err = new Error('Unauthorized')
      err.status = 401
      mockFetchDaqiAlerts.mockRejectedValue(err)

      const result = await daqiAlertHandler(request, mockH)

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(401)
      expect(result.output.payload.upstreamStatus).toBe(401)
    })

    it('should return 404 when Ricardo responds with not found', async () => {
      const err = new Error('Not Found')
      err.status = 404
      mockFetchDaqiAlerts.mockRejectedValue(err)

      const result = await daqiAlertHandler(request, mockH)

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(404)
      expect(result.output.payload.upstreamStatus).toBe(404)
    })

    it('should return 5xx when Ricardo responds with a server error', async () => {
      const err = new Error('Server Error')
      err.status = 503
      mockFetchDaqiAlerts.mockRejectedValue(err)

      const result = await daqiAlertHandler(request, mockH)

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(503)
      expect(result.output.payload.upstreamStatus).toBe(503)
    })

    it('should return 502 with null upstreamStatus when the error has no status (network/timeout)', async () => {
      mockFetchDaqiAlerts.mockRejectedValue(new Error('Connection refused'))

      const result = await daqiAlertHandler(request, mockH)

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBeNull()
    })

    it('should return 502 with null upstreamStatus when status is outside 4xx/5xx range', async () => {
      const err = new Error('Weird')
      err.status = 302
      mockFetchDaqiAlerts.mockRejectedValue(err)

      const result = await daqiAlertHandler(request, mockH)

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.upstreamStatus).toBeNull()
    })
  })
})
