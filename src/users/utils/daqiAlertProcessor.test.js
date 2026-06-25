import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  filterValidDaqiAlerts,
  getMatchingUsers,
  buildAlertKey,
  sendAlertToUser,
  processDaqiAlerts
} from './daqiAlertProcessor.js'

vi.mock('./ricardoApiClient.js', () => ({
  fetchDaqiAlerts: vi.fn()
}))

vi.mock('./notifyServiceClient.js', () => ({
  sendNotification: vi.fn()
}))

vi.mock('../../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      const values = {
        'daqiAlertTemplates.smsAlert': 'daqi-sms-template-id',
        'daqiAlertTemplates.smsAlertCy': 'daqi-sms-template-id-cy',
        'daqiAlertTemplates.emailAlert': 'daqi-email-template-id',
        'daqiAlertTemplates.emailAlertCy': 'daqi-email-template-id-cy',
        'notification.templates.unsubscribeEmailLink':
          'https://aqie-front-end.test/notify/unsubscribe-email-link',
        'alertTemplates.checkAirQualityLink':
          'https://check-air-quality.service.gov.uk/location/',
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

vi.mock('./ricardoSiteAndRegionCache.js', () => ({
  getRegionForSite: vi.fn().mockReturnValue(null),
  getSiteCacheSize: vi.fn().mockReturnValue(1),
  ensureSiteCachePopulated: vi.fn().mockResolvedValue(true)
}))

const { fetchDaqiAlerts } = await import('./ricardoApiClient.js')
const { sendNotification } = await import('./notifyServiceClient.js')
const { getRegionForSite, getSiteCacheSize, ensureSiteCachePopulated } =
  await import('./ricardoSiteAndRegionCache.js')

const sampleAlert = {
  '@id': '/api/d_a_q_i_alerts/7716220260528',
  '@type': 'DAQIAlert',
  id: 7716220260528,
  samplingPointId: 77162,
  siteId: 'UKA00819',
  region: 'Wales',
  daqi: 8,
  level: 'High',
  pollutant: 'O<sub>3</sub> (O3)',
  validationStatus: 2,
  date: '2026-06-08T02:00:00+01:00'
}

describe('daqiAlertProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Region is always resolved from siteId via the cache. sampleAlert's site
    // is in Wales (matching the default test users); a healthy cache is the
    // default. Individual tests override the region or cache state as needed.
    getRegionForSite.mockReturnValue('Wales')
    getSiteCacheSize.mockReturnValue(1)
    ensureSiteCachePopulated.mockResolvedValue(true)
  })

  describe('buildAlertKey', () => {
    it('should combine samplingPointId, siteId, and date', () => {
      expect(buildAlertKey(sampleAlert)).toBe(
        '77162-UKA00819-2026-06-08T02:00:00+01:00'
      )
    })
  })

  describe('filterValidDaqiAlerts', () => {
    it('keeps alerts with daqi >= threshold AND validationStatus = 2', () => {
      const members = [
        sampleAlert,
        { ...sampleAlert, samplingPointId: 1, daqi: 6 },
        { ...sampleAlert, samplingPointId: 2, validationStatus: 1 }
      ]
      const result = filterValidDaqiAlerts(members, 7)
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        'alert-id': '77162-UKA00819-2026-06-08T02:00:00+01:00',
        samplingPointId: 77162,
        siteId: 'UKA00819',
        daqi: 8
      })
      expect(result[0].validationStatus).toBeUndefined()
    })

    it('drops entries missing samplingPointId, siteId, or date', () => {
      const members = [
        { ...sampleAlert, samplingPointId: undefined },
        { ...sampleAlert, siteId: '' },
        { ...sampleAlert, date: '' }
      ]
      expect(filterValidDaqiAlerts(members, 7)).toHaveLength(0)
    })

    it('respects the threshold parameter', () => {
      const members = [{ ...sampleAlert, daqi: 5 }]
      expect(filterValidDaqiAlerts(members, 5)).toHaveLength(1)
      expect(filterValidDaqiAlerts(members, 6)).toHaveLength(0)
    })
  })

  describe('getMatchingUsers', () => {
    it('returns one entry per user-location whose region matches', () => {
      const users = [
        {
          user_contact: 'a@test.com',
          alertType: 'email',
          lang: 'en',
          locations: [
            { location: 'Cardiff', region: 'Wales' },
            { location: 'London', region: 'Greater London' }
          ]
        },
        {
          user_contact: '07700900111',
          alertType: 'sms',
          lang: 'cy',
          locations: [{ location: 'Swansea', region: 'Wales' }]
        }
      ]
      const matched = getMatchingUsers(users, 'Wales')
      expect(matched).toEqual([
        {
          userContact: 'a@test.com',
          alertType: 'email',
          location: 'Cardiff',
          lang: 'en'
        },
        {
          userContact: '07700900111',
          alertType: 'sms',
          location: 'Swansea',
          lang: 'cy'
        }
      ])
    })

    it('defaults lang to en when user.lang is missing', () => {
      const users = [
        {
          user_contact: 'a@test.com',
          alertType: 'email',
          locations: [{ location: 'Cardiff', region: 'Wales' }]
        }
      ]
      expect(getMatchingUsers(users, 'Wales')[0].lang).toBe('en')
    })
  })

  describe('sendAlertToUser', () => {
    it('builds sms payload with English template', async () => {
      sendNotification.mockResolvedValueOnce({ notificationId: 'notif-123' })
      const notificationId = await sendAlertToUser(
        {
          userContact: '07700900111',
          alertType: 'sms',
          location: 'Cardiff',
          lang: 'en'
        },
        {
          'alert-id': '77162-UKA00819-2026-06-08T02:00:00+01:00',
          daqi: 8,
          pollutant: 'O<sub>3</sub> (O3)'
        }
      )

      expect(notificationId).toBe('notif-123')
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'daqi-sms-template-id',
          phoneNumber: '07700900111',
          personalisation: expect.objectContaining({
            location: 'Cardiff',
            daqi: '8',
            Pollutant: 'ozone (O3)',
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/cardiff?lang=en'
          })
        }),
        expect.stringMatching(
          /^daqi-alert-77162-UKA00819-2026-06-08T02:00:00\+01:00-\d+$/
        )
      )
    })

    it('builds email payload with Welsh template and unsubscribe link', async () => {
      sendNotification.mockResolvedValueOnce({ notificationId: 'notif-cy' })
      await sendAlertToUser(
        {
          userContact: 'dewi@example.com',
          alertType: 'email',
          location: 'Cardiff',
          lang: 'cy'
        },
        {
          'alert-id': 'X',
          daqi: 7,
          pollutant: 'NO<sub>2</sub> (NO2)'
        }
      )

      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'daqi-email-template-id-cy',
          emailAddress: 'dewi@example.com',
          personalisation: expect.objectContaining({
            Pollutant: 'nitrogen dioxide (NO2)',
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/cardiff?lang=cy',
            unsubscribeLink:
              'https://aqie-front-end.test/notify/unsubscribe-email-link?email=dewi%40example.com'
          })
        }),
        expect.any(String)
      )
    })

    it('defaults lang to en when userMatch.lang is falsy', async () => {
      sendNotification.mockResolvedValueOnce({ notificationId: 'n' })
      await sendAlertToUser(
        {
          userContact: '07700900222',
          alertType: 'sms',
          location: 'Cardiff',
          lang: ''
        },
        { 'alert-id': 'X', daqi: 7, pollutant: 'O3' }
      )
      const [[payload]] = sendNotification.mock.calls
      expect(payload.templateId).toBe('daqi-sms-template-id')
      expect(payload.personalisation.checkAirQualityLink).toContain('?lang=en')
    })
  })

  describe('processDaqiAlerts', () => {
    function makeDb() {
      const stateCollection = {
        find: vi.fn(() => ({
          project: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) }))
        })),
        updateOne: vi.fn().mockResolvedValue(undefined)
      }
      const auditCollection = {
        insertOne: vi.fn().mockResolvedValue(undefined),
        updateOne: vi.fn().mockResolvedValue(undefined)
      }
      const usersCollection = {
        find: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([
            {
              user_contact: '07700900111',
              alertType: 'sms',
              lang: 'en',
              locations: [{ location: 'Cardiff', region: 'Wales' }]
            }
          ])
        }))
      }
      return {
        collection: vi.fn((name) => {
          if (name === 'daqi-alert-processing-state') return stateCollection
          if (name === 'daqi-alerts-audit') return auditCollection
          if (name === 'USERS') return usersCollection
          return null
        }),
        _state: stateCollection,
        _audit: auditCollection,
        _users: usersCollection
      }
    }

    it('exits early when fetchDaqiAlerts throws', async () => {
      const db = makeDb()
      fetchDaqiAlerts.mockRejectedValueOnce(
        Object.assign(new Error('boom'), { status: 502 })
      )

      await processDaqiAlerts(db)

      expect(db._state.updateOne).not.toHaveBeenCalled()
      expect(sendNotification).not.toHaveBeenCalled()
    })

    it('exits early when no alert members are returned', async () => {
      const db = makeDb()
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [] })

      await processDaqiAlerts(db)

      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('processes valid alert: marks in-progress, sends notification, marks processed', async () => {
      const db = makeDb()
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [sampleAlert] })
      sendNotification.mockResolvedValueOnce({ notificationId: 'notif-1' })

      await processDaqiAlerts(db)

      expect(db._state.updateOne).toHaveBeenCalledWith(
        {
          samplingPointId: 77162,
          siteId: 'UKA00819',
          date: '2026-06-08T02:00:00+01:00'
        },
        expect.objectContaining({
          $set: expect.objectContaining({
            'process-status': 'in-progress',
            'alert-started-timestamp': expect.any(Date)
          })
        }),
        { upsert: true }
      )

      expect(db._audit.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          'alert-id': '77162-UKA00819-2026-06-08T02:00:00+01:00',
          'daqi-alert-status': 'not-processed',
          notificationId: null
        })
      )

      expect(sendNotification).toHaveBeenCalledTimes(1)

      expect(db._audit.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          'alert-id': '77162-UKA00819-2026-06-08T02:00:00+01:00',
          'daqi-alert-status': 'not-processed'
        }),
        {
          $set: {
            'daqi-alert-status': 'processed',
            notificationId: 'notif-1'
          }
        }
      )

      expect(db._state.updateOne).toHaveBeenLastCalledWith(
        {
          samplingPointId: 77162,
          siteId: 'UKA00819',
          date: '2026-06-08T02:00:00+01:00'
        },
        expect.objectContaining({
          $set: expect.objectContaining({ 'process-status': 'processed' })
        })
      )
    })

    it('skips alerts already in processed/in-progress state', async () => {
      const db = makeDb()
      db._state.find.mockReturnValueOnce({
        project: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([
            {
              samplingPointId: 77162,
              siteId: 'UKA00819',
              date: '2026-06-08T02:00:00+01:00'
            }
          ])
        }))
      })
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [sampleAlert] })

      await processDaqiAlerts(db)

      expect(sendNotification).not.toHaveBeenCalled()
      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('drops alerts that do not meet threshold or validation status', async () => {
      const db = makeDb()
      fetchDaqiAlerts.mockResolvedValueOnce({
        member: [
          { ...sampleAlert, daqi: 5 },
          { ...sampleAlert, samplingPointId: 99, validationStatus: 1 }
        ]
      })

      await processDaqiAlerts(db)

      expect(sendNotification).not.toHaveBeenCalled()
      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('collapses duplicate (samplingPointId, siteId, date) rows in a single response', async () => {
      const db = makeDb()
      fetchDaqiAlerts.mockResolvedValueOnce({
        member: [sampleAlert, { ...sampleAlert }]
      })
      sendNotification.mockResolvedValue({ notificationId: 'notif-x' })

      await processDaqiAlerts(db)

      expect(sendNotification).toHaveBeenCalledTimes(1)
    })

    it('uses region from getRegionForSite when present', async () => {
      const db = makeDb()
      getRegionForSite.mockReturnValueOnce('North East')
      db._users.find.mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([])
      })
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [sampleAlert] })

      await processDaqiAlerts(db)

      expect(db._users.find).toHaveBeenCalledWith({
        'locations.region': 'North East'
      })
    })

    it('does not mark processed when at least one user notify call fails', async () => {
      const db = makeDb()
      db._users.find.mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: 'a@test.com',
            alertType: 'email',
            lang: 'en',
            locations: [{ location: 'Cardiff', region: 'Wales' }]
          },
          {
            user_contact: 'b@test.com',
            alertType: 'email',
            lang: 'en',
            locations: [{ location: 'Cardiff', region: 'Wales' }]
          }
        ])
      })
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [sampleAlert] })
      sendNotification
        .mockResolvedValueOnce({ notificationId: 'ok' })
        .mockRejectedValueOnce(new Error('notify down'))

      await processDaqiAlerts(db)

      const stateUpdateCalls = db._state.updateOne.mock.calls
      const processedCall = stateUpdateCalls.find((call) =>
        JSON.stringify(call).includes('"processed"')
      )
      expect(processedCall).toBeUndefined()
    })

    it('skips an alert whose siteId is not in the site cache (no notification)', async () => {
      const db = makeDb()
      getRegionForSite.mockReturnValue(null)
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [sampleAlert] })

      await processDaqiAlerts(db)

      // Region can't be resolved → alert skipped, never marked in-progress.
      expect(sendNotification).not.toHaveBeenCalled()
      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('skips the cycle when the site cache is empty and refresh fails', async () => {
      const db = makeDb()
      getSiteCacheSize.mockReturnValue(0)
      ensureSiteCachePopulated.mockResolvedValue(false)
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [sampleAlert] })

      await processDaqiAlerts(db)

      expect(ensureSiteCachePopulated).toHaveBeenCalled()
      expect(sendNotification).not.toHaveBeenCalled()
      expect(db._state.updateOne).not.toHaveBeenCalled()
    })
  })
})
