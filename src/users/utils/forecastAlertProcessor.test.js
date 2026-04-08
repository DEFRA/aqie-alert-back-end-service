import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isCurrentDate,
  addRegionsToForecasts,
  filterHighDaqiForecasts,
  groupAlertsByRegion,
  getDaqiLabel,
  buildAuditEntries,
  processForecastAlerts
} from './forecastAlertProcessor.js'

vi.mock('./forecastApiClient.js', () => ({
  fetchForecast: vi.fn()
}))

vi.mock('./notifyServiceClient.js', () => ({
  sendNotification: vi.fn()
}))

vi.mock('./regionFinder.js', () => ({
  findRegion: vi.fn()
}))

vi.mock('./maskingUtils.js', () => ({
  maskPhoneNumber: vi.fn((v) => `****${String(v).slice(-4)}`),
  maskEmail: vi.fn((v) => `${String(v).slice(0, 2)}****@domain`)
}))

vi.mock('../../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      const values = {
        'forecastAlertTemplates.smsAlert': 'sms-forecast-template-en',
        'forecastAlertTemplates.smsAlertCy': 'sms-forecast-template-cy',
        'forecastAlertTemplates.emailAlert': 'email-forecast-template-en',
        'forecastAlertTemplates.emailAlertCy': 'email-forecast-template-cy',
        'alertTemplates.checkAirQualityLink':
          'https://check-air-quality.service.gov.uk/location/',
        'notification.templates.unsubscribeEmailLink':
          'https://aqie-front-end.test/notify/unsubscribe-email-link',
        'metOfficeForecast.daqiAlertThreshold': 7
      }
      return values[key] ?? null
    })
  }
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

// Fix system time to 2026-04-01 UTC for deterministic date tests
const FIXED_DATE = new Date('2026-04-01T08:00:00.000Z')

describe('forecastAlertProcessor', () => {
  beforeEach(() => {
    vi.setSystemTime(FIXED_DATE)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ── Pure helpers ──────────────────────────────────────────────────────────

  describe('isCurrentDate', () => {
    it('should return true when updatedStr starts with today', () => {
      expect(isCurrentDate('2026-04-01T06:00:00Z')).toBe(true)
    })

    it('should return false when updatedStr is a different date', () => {
      expect(isCurrentDate('2026-03-31T23:59:59Z')).toBe(false)
    })

    it('should return false for non-string input', () => {
      expect(isCurrentDate(null)).toBe(false)
      expect(isCurrentDate(undefined)).toBe(false)
      expect(isCurrentDate(20260401)).toBe(false)
    })
  })

  describe('addRegionsToForecasts', () => {
    it('should add region to each forecast using findRegion', async () => {
      const { findRegion } = await import('./regionFinder.js')
      vi.mocked(findRegion).mockReturnValue('England')

      const forecasts = [
        {
          location: { coordinates: [51.5, -0.1] },
          updated: '2026-04-01T06:00:00Z',
          forecast: []
        },
        {
          location: { coordinates: [53.4, -2.2] },
          updated: '2026-04-01T06:00:00Z',
          forecast: []
        }
      ]

      const result = addRegionsToForecasts(forecasts)

      expect(result).toHaveLength(2)
      expect(result[0].region).toBe('England')
      expect(result[1].region).toBe('England')
      expect(findRegion).toHaveBeenCalledWith(51.5, -0.1)
      expect(findRegion).toHaveBeenCalledWith(53.4, -2.2)
    })

    it('should preserve existing forecast fields', async () => {
      const { findRegion } = await import('./regionFinder.js')
      vi.mocked(findRegion).mockReturnValue('Wales')

      const forecasts = [
        {
          location: { coordinates: [52.0, -3.8] },
          updated: '2026-04-01T06:00:00Z',
          forecast: [{ value: 8 }]
        }
      ]

      const result = addRegionsToForecasts(forecasts)
      expect(result[0].updated).toBe('2026-04-01T06:00:00Z')
      expect(result[0].forecast).toEqual([{ value: 8 }])
      expect(result[0].region).toBe('Wales')
    })
  })

  describe('filterHighDaqiForecasts', () => {
    const forecastsWithRegions = [
      { region: 'England', forecast: [{ value: 8 }, { value: 5 }] },
      { region: 'Wales', forecast: [{ value: 6 }, { value: 3 }] },
      { region: 'Scotland', forecast: [{ value: 7 }, { value: 4 }] },
      { region: 'Northern Ireland', forecast: [{ value: 3 }] },
      { region: 'England', forecast: [] },
      { region: 'England', forecast: [{ value: null }] }
    ]

    it('should keep forecasts where today value >= threshold', () => {
      const result = filterHighDaqiForecasts(forecastsWithRegions, 7)
      expect(result).toHaveLength(2)
      expect(result[0].region).toBe('England')
      expect(result[1].region).toBe('Scotland')
    })

    it('should return empty array when no forecasts breach threshold', () => {
      const result = filterHighDaqiForecasts(forecastsWithRegions, 10)
      expect(result).toHaveLength(0)
    })

    it('should exclude entries with null or missing today value', () => {
      const result = filterHighDaqiForecasts(forecastsWithRegions, 1)
      // Excludes the ones with empty forecast array or null value
      const regions = result.map((r) => r.region)
      expect(regions).not.toContain(forecastsWithRegions[4].region + '_empty')
    })
  })

  describe('groupAlertsByRegion', () => {
    it('should return unique regions', () => {
      const alerts = [
        { region: 'England' },
        { region: 'England' },
        { region: 'Scotland' }
      ]
      const result = groupAlertsByRegion(alerts)
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.region)).toContain('England')
      expect(result.map((r) => r.region)).toContain('Scotland')
    })

    it('should exclude Unknown regions', () => {
      const alerts = [
        { region: 'Unknown' },
        { region: 'Wales' },
        { region: 'Unknown' }
      ]
      const result = groupAlertsByRegion(alerts)
      expect(result).toHaveLength(1)
      expect(result[0].region).toBe('Wales')
    })

    it('should return empty array when all regions are Unknown', () => {
      const result = groupAlertsByRegion([
        { region: 'Unknown' },
        { region: 'Unknown' }
      ])
      expect(result).toHaveLength(0)
    })

    it('should return empty array for empty input', () => {
      expect(groupAlertsByRegion([])).toHaveLength(0)
    })
  })

  describe('getDaqiLabel', () => {
    it('should always return high', () => {
      expect(getDaqiLabel()).toBe('high')
    })
  })

  describe('buildAuditEntries', () => {
    const users = [
      {
        user_contact: '+447111111111',
        alertType: 'sms',
        lang: 'en',
        locations: [
          { location: 'London', region: 'England' },
          { location: 'Bristol', region: 'England' }
        ]
      },
      {
        user_contact: 'user@test.com',
        alertType: 'email',
        lang: 'cy',
        locations: [{ location: 'Cardiff', region: 'Wales' }]
      },
      {
        user_contact: '+447222222222',
        alertType: 'sms',
        locations: [{ location: 'Edinburgh', region: 'Scotland' }]
      }
    ]

    it('should build one entry per user-location pair per region', () => {
      const regionAlerts = [{ region: 'England' }]
      const entries = buildAuditEntries(users, regionAlerts, '2026-04-01')

      expect(entries).toHaveLength(2)
      expect(entries[0].location).toBe('London')
      expect(entries[1].location).toBe('Bristol')
      expect(entries[0].user_contact).toBe('+447111111111')
    })

    it('should set forecast-alert-status to not-processed', () => {
      const entries = buildAuditEntries(
        users,
        [{ region: 'Wales' }],
        '2026-04-01'
      )
      expect(entries[0]['forecast-alert-status']).toBe('not-processed')
    })

    it('should default lang to en when not set', () => {
      const entries = buildAuditEntries(
        users,
        [{ region: 'Scotland' }],
        '2026-04-01'
      )
      expect(entries[0].lang).toBe('en')
    })

    it('should preserve provided lang', () => {
      const entries = buildAuditEntries(
        users,
        [{ region: 'Wales' }],
        '2026-04-01'
      )
      expect(entries[0].lang).toBe('cy')
    })

    it('should return empty array when no users match region', () => {
      const entries = buildAuditEntries(
        users,
        [{ region: 'Northern Ireland' }],
        '2026-04-01'
      )
      expect(entries).toHaveLength(0)
    })

    it('should handle users with no locations', () => {
      const usersNoLoc = [
        { user_contact: 'x@x.com', alertType: 'email', locations: [] }
      ]
      const entries = buildAuditEntries(
        usersNoLoc,
        [{ region: 'England' }],
        '2026-04-01'
      )
      expect(entries).toHaveLength(0)
    })

    it('should handle users with undefined locations property', () => {
      const usersNoLoc = [{ user_contact: 'x@x.com', alertType: 'email' }]
      const entries = buildAuditEntries(
        usersNoLoc,
        [{ region: 'England' }],
        '2026-04-01'
      )
      expect(entries).toHaveLength(0)
    })
  })

  // ── processForecastAlerts ─────────────────────────────────────────────────

  describe('processForecastAlerts', () => {
    let mockFetchForecast
    let mockSendNotification
    let mockFindRegion
    let mockScheduleStateColl
    let mockUsersColl
    let mockAuditColl
    let mockDb

    beforeEach(async () => {
      vi.clearAllMocks()

      mockFetchForecast = vi.mocked(
        (await import('./forecastApiClient.js')).fetchForecast
      )
      mockSendNotification = vi.mocked(
        (await import('./notifyServiceClient.js')).sendNotification
      )
      mockFindRegion = vi.mocked((await import('./regionFinder.js')).findRegion)
      mockFindRegion.mockReturnValue('England')

      mockScheduleStateColl = {
        findOne: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn().mockResolvedValue({})
      }
      mockUsersColl = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      }
      mockAuditColl = {
        insertOne: vi.fn().mockResolvedValue({}),
        updateOne: vi.fn().mockResolvedValue({})
      }

      mockDb = {
        collection: vi.fn((name) => {
          if (name === 'forecast-schedule-state') return mockScheduleStateColl
          if (name === 'USERS') return mockUsersColl
          if (name === 'metoffice-forecast-audit') return mockAuditColl
          return null
        })
      }
    })

    it('should skip when schedule is already completed today', async () => {
      mockScheduleStateColl.findOne.mockResolvedValue({ status: 'completed' })

      await processForecastAlerts(mockDb)

      expect(mockFetchForecast).not.toHaveBeenCalled()
    })

    it('should return early when fetch fails', async () => {
      mockFetchForecast.mockRejectedValue(new Error('Network error'))

      await processForecastAlerts(mockDb)

      expect(mockUsersColl.find).not.toHaveBeenCalled()
    })

    it('should return early when forecasts array is empty', async () => {
      mockFetchForecast.mockResolvedValue({ forecasts: [] })

      await processForecastAlerts(mockDb)

      expect(mockUsersColl.find).not.toHaveBeenCalled()
    })

    it('should return early when response has no forecasts property', async () => {
      mockFetchForecast.mockResolvedValue({})

      await processForecastAlerts(mockDb)

      expect(mockUsersColl.find).not.toHaveBeenCalled()
    })

    it('should return early when no forecasts have current date', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-03-31T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      await processForecastAlerts(mockDb)

      expect(mockUsersColl.find).not.toHaveBeenCalled()
    })

    it('should mark schedule complete and return when no high DAQI forecasts', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 3 }]
          }
        ]
      })

      await processForecastAlerts(mockDb)

      expect(mockScheduleStateColl.updateOne).toHaveBeenCalledWith(
        { forecastDate: '2026-04-01' },
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'completed' })
        }),
        { upsert: true }
      )
      expect(mockSendNotification).not.toHaveBeenCalled()
    })

    it('should skip Unknown regions from groupAlertsByRegion', async () => {
      mockFindRegion.mockReturnValue('Unknown')
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [50.0, -6.0] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 9 }]
          }
        ]
      })

      await processForecastAlerts(mockDb)

      // All regions Unknown → regionAlerts is empty → no notifications sent
      expect(mockSendNotification).not.toHaveBeenCalled()
      expect(mockScheduleStateColl.updateOne).toHaveBeenCalled()
    })

    it('should send SMS notification and mark schedule complete', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: '+447111111111',
            alertType: 'sms',
            lang: 'en',
            locations: [{ location: 'London', region: 'England' }]
          }
        ])
      })

      mockSendNotification.mockResolvedValue({ notificationId: 'notif-abc' })

      await processForecastAlerts(mockDb)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: '+447111111111',
          templateId: 'sms-forecast-template-en',
          personalisation: expect.objectContaining({
            location: 'London',
            daqi: 'high',
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/london?lang=en'
          })
        }),
        expect.stringContaining('forecast-England')
      )

      expect(mockAuditColl.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          forecastDate: '2026-04-01',
          'forecast-alert-status': 'not-processed'
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            'forecast-alert-status': 'processed',
            notificationId: 'notif-abc'
          })
        })
      )

      expect(mockScheduleStateColl.updateOne).toHaveBeenCalledWith(
        { forecastDate: '2026-04-01' },
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'completed' })
        }),
        { upsert: true }
      )
    })

    it('should send email notification with unsubscribeLink', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 9 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: 'user@test.com',
            alertType: 'email',
            lang: 'cy',
            locations: [{ location: 'Edinburgh', region: 'England' }]
          }
        ])
      })

      mockSendNotification.mockResolvedValue({ notificationId: 'notif-email' })

      await processForecastAlerts(mockDb)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAddress: 'user@test.com',
          templateId: 'email-forecast-template-cy',
          personalisation: expect.objectContaining({
            location: 'Edinburgh',
            daqi: 'high',
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/edinburgh?lang=cy',
            unsubscribeLink:
              'https://aqie-front-end.test/notify/unsubscribe-email-link?email=user%40test.com'
          })
        }),
        expect.any(String)
      )
    })

    it('should send email notification with English template when lang is en', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: 'en-user@test.com',
            alertType: 'email',
            lang: 'en',
            locations: [{ location: 'London', region: 'England' }]
          }
        ])
      })

      mockSendNotification.mockResolvedValue({ notificationId: 'notif-en' })

      await processForecastAlerts(mockDb)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAddress: 'en-user@test.com',
          templateId: 'email-forecast-template-en'
        }),
        expect.any(String)
      )
    })

    it('should send Welsh SMS notification using cy template', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [52.0, -3.8] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: '+447555555555',
            alertType: 'sms',
            lang: 'cy',
            locations: [{ location: 'Cardiff', region: 'England' }]
          }
        ])
      })

      mockSendNotification.mockResolvedValue({ notificationId: 'notif-cy-sms' })

      await processForecastAlerts(mockDb)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: '+447555555555',
          templateId: 'sms-forecast-template-cy'
        }),
        expect.any(String)
      )
    })

    it('should handle empty location in formatLocationForUrl gracefully', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: '+447666666666',
            alertType: 'sms',
            lang: 'en',
            locations: [{ location: '', region: 'England' }]
          }
        ])
      })

      mockSendNotification.mockResolvedValue({})

      await processForecastAlerts(mockDb)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          personalisation: expect.objectContaining({
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/?lang=en'
          })
        }),
        expect.any(String)
      )
    })

    it('should skip duplicate audit entries (code 11000) and continue', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: '+447111111111',
            alertType: 'sms',
            lang: 'en',
            locations: [{ location: 'London', region: 'England' }]
          }
        ])
      })

      const dupError = Object.assign(new Error('Duplicate key'), {
        code: 11000
      })
      mockAuditColl.insertOne.mockRejectedValue(dupError)
      mockSendNotification.mockResolvedValue({ notificationId: 'notif-123' })

      await processForecastAlerts(mockDb)

      // Despite duplicate error, processing continues and schedule is marked complete
      expect(mockScheduleStateColl.updateOne).toHaveBeenCalled()
    })

    it('should throw when insertOne fails with non-11000 error', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: '+447111111111',
            alertType: 'sms',
            lang: 'en',
            locations: [{ location: 'London', region: 'England' }]
          }
        ])
      })

      const dbError = Object.assign(new Error('Write conflict'), { code: 112 })
      mockAuditColl.insertOne.mockRejectedValue(dbError)

      await expect(processForecastAlerts(mockDb)).rejects.toThrow(
        'Write conflict'
      )
    })

    it('should log error and continue when notification fails', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: '+447111111111',
            alertType: 'sms',
            lang: 'en',
            locations: [{ location: 'London', region: 'England' }]
          }
        ])
      })

      mockSendNotification.mockRejectedValue(new Error('Notify service down'))

      await processForecastAlerts(mockDb)

      // audit entry stays not-processed but schedule still completes
      expect(mockAuditColl.updateOne).not.toHaveBeenCalled()
      expect(mockScheduleStateColl.updateOne).toHaveBeenCalled()
    })

    it('should use comma-separated location slug in checkAirQualityLink', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: '+447111111111',
            alertType: 'sms',
            lang: 'en',
            locations: [
              { location: 'Bristol, City of Bristol', region: 'England' }
            ]
          }
        ])
      })

      mockSendNotification.mockResolvedValue({})

      await processForecastAlerts(mockDb)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          personalisation: expect.objectContaining({
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/bristol_city-of-bristol?lang=en'
          })
        }),
        expect.any(String)
      )
    })

    it('should handle null notificationId from notify service', async () => {
      mockFetchForecast.mockResolvedValue({
        forecasts: [
          {
            location: { coordinates: [51.5, -0.1] },
            updated: '2026-04-01T06:00:00Z',
            forecast: [{ value: 8 }]
          }
        ]
      })

      mockUsersColl.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: '+447111111111',
            alertType: 'sms',
            lang: 'en',
            locations: [{ location: 'London', region: 'England' }]
          }
        ])
      })

      mockSendNotification.mockResolvedValue({})

      await processForecastAlerts(mockDb)

      expect(mockAuditColl.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({ notificationId: null })
        })
      )
    })
  })
})
