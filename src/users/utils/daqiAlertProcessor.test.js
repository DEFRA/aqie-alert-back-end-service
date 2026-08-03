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

const SAMPLE_ALERT_DATE = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago — within 24h

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
  date: SAMPLE_ALERT_DATE
}

const staleAlert = {
  ...sampleAlert,
  date: '2025-12-04T02:00:00+01:00' // >24h ago — should be filtered by Option A
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
        `77162-UKA00819-${SAMPLE_ALERT_DATE}`
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

    it('drops entries whose date is older than 24h', () => {
      expect(filterValidDaqiAlerts([staleAlert], 7)).toHaveLength(0)
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
            'daqi-level': 'high',
            'daqi-level-title': 'High',
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/cardiff?lang=en'
          })
        }),
        expect.stringMatching(/^daqi-alert-.+-\d+$/)
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
            location: 'Cardiff',
            'daqi-level': 'high',
            'daqi-level-title': 'High',
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/cardiff?lang=cy',
            unsubscribeLink:
              'https://aqie-front-end.test/notify/unsubscribe-email-link?email=dewi%40example.com'
          })
        }),
        expect.any(String)
      )
    })

    it('uses "very high" daqi-level when alertDetail.daqi is 10', async () => {
      sendNotification.mockResolvedValueOnce({ notificationId: 'notif-vh' })
      await sendAlertToUser(
        {
          userContact: '07700900111',
          alertType: 'sms',
          location: 'Cardiff',
          lang: 'en'
        },
        { 'alert-id': 'X', daqi: 10, pollutant: 'O3' }
      )
      const [[payload]] = sendNotification.mock.calls
      expect(payload.personalisation['daqi-level']).toBe('very high')
      expect(payload.personalisation['daqi-level-title']).toBe('Very high')
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
      // stateCollection.find supports BOTH chains the code base might use:
      //   find().toArray()             (new combo-key lookup)
      //   find().project().toArray()   (legacy / other callers)
      // Default: empty result. Individual tests override per-call via
      // db._state.find.mockReturnValueOnce(...).
      const stateCollection = {
        find: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([]),
          sort: vi.fn(function () {
            return this
          }),
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

      // State collection is keyed by samplingPointId alone (Ricardo guarantees
      // samplingPointId identifies exactly one (pollutant, location) pair).
      // siteId and pollutant are stored on the row as informational context.
      // 'alert-started-timestamp' mirrors Ricardo's `date` (the breach
      // reading timestamp). lastUpdatedFromRicardo is server time (new Date())
      // so the 24h dedup window measures when WE last processed, not when
      // Ricardo last read.
      expect(db._state.updateOne).toHaveBeenCalledWith(
        {
          samplingPointId: 77162,
          'alert-started-timestamp': SAMPLE_ALERT_DATE
        },
        {
          $set: {
            samplingPointId: 77162,
            siteId: 'UKA00819',
            pollutant: 'O3 (O3)',
            daqi: 8,
            region: 'Wales',
            lastUpdatedFromRicardo: SAMPLE_ALERT_DATE,
            'process-status': 'in-progress',
            'alert-started-timestamp': SAMPLE_ALERT_DATE
          }
        },
        { upsert: true }
      )

      // Audit row still carries the date-bearing alert-id so each notification
      // traces back to a specific Ricardo emission.
      expect(db._audit.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          'alert-id': `77162-UKA00819-${SAMPLE_ALERT_DATE}`,
          'daqi-alert-status': 'not-processed',
          notificationId: null
        })
      )

      expect(sendNotification).toHaveBeenCalledTimes(1)

      expect(db._audit.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          'alert-id': `77162-UKA00819-${SAMPLE_ALERT_DATE}`,
          'daqi-alert-status': 'not-processed'
        }),
        {
          $set: {
            'daqi-alert-status': 'processed',
            notificationId: 'notif-1'
          }
        }
      )

      // The final state update flips to 'processed'. The 24h dedup window is
      // anchored to `lastUpdatedFromRicardo` (set by markAlertInProgress and
      // updateStateForExistingAlert), so markAlertProcessed only needs to
      // update the status flag.
      expect(db._state.updateOne).toHaveBeenLastCalledWith(
        {
          samplingPointId: 77162,
          'alert-started-timestamp': SAMPLE_ALERT_DATE
        },
        {
          $set: {
            'process-status': 'processed'
          }
        }
      )
    })

    it('does NOT re-notify when Ricardo last confirmed this combo within the last 24h (update-only)', async () => {
      const db = makeDb()
      const fiveHoursAgo = new Date(
        Date.now() - 5 * 60 * 60 * 1000
      ).toISOString()
      db._state.find.mockReturnValueOnce({
        sort: vi.fn(function () {
          return this
        }),
        toArray: vi.fn().mockResolvedValue([
          {
            samplingPointId: 77162,
            siteId: 'UKA00819',
            pollutant: 'O<sub>3</sub> (O3)',
            'process-status': 'processed',
            'alert-started-timestamp': fiveHoursAgo,
            lastUpdatedFromRicardo: fiveHoursAgo
          }
        ])
      })
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [sampleAlert] })

      await processDaqiAlerts(db)

      // No user notification this cycle
      expect(sendNotification).not.toHaveBeenCalled()
      // But the state row was bumped with lastUpdatedFromRicardo
      expect(db._state.updateOne).toHaveBeenCalledWith(
        {
          samplingPointId: 77162,
          'alert-started-timestamp': expect.any(String)
        },
        {
          $set: expect.objectContaining({
            lastUpdatedFromRicardo: SAMPLE_ALERT_DATE,
            daqi: 8
          })
        }
      )
    })

    it('re-notifies when Ricardo has been quiet on this combo for more than 24h', async () => {
      const db = makeDb()
      const twentyFiveHoursAgo = new Date(
        Date.now() - 25 * 60 * 60 * 1000
      ).toISOString()
      db._state.find.mockReturnValueOnce({
        sort: vi.fn(function () {
          return this
        }),
        toArray: vi.fn().mockResolvedValue([
          {
            samplingPointId: 77162,
            siteId: 'UKA00819',
            pollutant: 'O<sub>3</sub> (O3)',
            'process-status': 'processed',
            lastUpdatedFromRicardo: twentyFiveHoursAgo
          }
        ])
      })
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [sampleAlert] })
      sendNotification.mockResolvedValueOnce({
        notificationId: 'notif-next-day'
      })

      await processDaqiAlerts(db)

      expect(sendNotification).toHaveBeenCalledTimes(1)
    })

    it('skips a combo left in-progress by a prior crashed cycle', async () => {
      const db = makeDb()
      db._state.find.mockReturnValueOnce({
        sort: vi.fn(function () {
          return this
        }),
        toArray: vi.fn().mockResolvedValue([
          {
            samplingPointId: 77162,
            siteId: 'UKA00819',
            pollutant: 'O<sub>3</sub> (O3)',
            'process-status': 'in-progress'
            // 'in-progress' at cycle start means the prior cycle crashed —
            // mongo-lock serialises cycles so no concurrent cycle can hold it.
          }
        ])
      })
      fetchDaqiAlerts.mockResolvedValueOnce({ member: [sampleAlert] })

      await processDaqiAlerts(db)

      expect(sendNotification).not.toHaveBeenCalled()
      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('collapses rows with same combo but different dates into one notification', async () => {
      const db = makeDb()
      const t2 = new Date(Date.now() - 50 * 60 * 1000).toISOString()
      const t3 = new Date(Date.now() - 40 * 60 * 1000).toISOString() // latest
      fetchDaqiAlerts.mockResolvedValueOnce({
        member: [
          sampleAlert, // t1: oldest (~60 min ago), daqi 8 — should win (oldest timestamp)
          { ...sampleAlert, date: t2, daqi: 9 }, // t2: middle (~50 min ago)
          { ...sampleAlert, date: t3, daqi: 8 } // t3: latest (~40 min ago)
        ]
      })
      sendNotification.mockResolvedValue({ notificationId: 'notif-x' })

      await processDaqiAlerts(db)

      // Three rows, same samplingPointId — collapses to one notification
      expect(sendNotification).toHaveBeenCalledTimes(1)

      // Cron-job rule: oldest timestamp anchors alert-started-timestamp
      // (breach-started time) — t1 (SAMPLE_ALERT_DATE, ~60 min ago) is oldest.
      // But daqi and lastUpdatedFromRicardo reflect Ricardo's LATEST reading
      // (t3, ~40 min ago, daqi 8) captured pre-dedup.
      expect(db._state.updateOne).toHaveBeenCalledWith(
        {
          samplingPointId: 77162,
          'alert-started-timestamp': SAMPLE_ALERT_DATE
        },
        expect.objectContaining({
          $set: expect.objectContaining({
            lastUpdatedFromRicardo: t3,
            daqi: 8,
            'alert-started-timestamp': SAMPLE_ALERT_DATE
          })
        }),
        { upsert: true }
      )
    })

    it('update-only: bumps lastUpdatedFromRicardo and daqi to the LATEST in-cycle reading when multiple readings exist for the same samplingPointId', async () => {
      // Ricardo emits two readings for samplingPointId 77162 in one cycle response.
      // The state row is already processed and within 24h → verdict = 'update-only'.
      // deduplicateAlertsOldestFirst keeps the OLDEST reading as the breach-start
      // anchor, but the pre-dedup latest-reading snapshot means
      // updateStateForExistingAlert writes the LATEST date/daqi so the state row
      // reflects Ricardo's most recent measurement (the reported bug: daqi and
      // lastUpdatedFromRicardo must move to the newer reading).
      const db = makeDb()
      const olderReadingDate = new Date(
        Date.now() - 80 * 60 * 1000
      ).toISOString() // 80 min ago, daqi 9 — breach-start anchor
      const latestReadingDate = new Date(
        Date.now() - 40 * 60 * 1000
      ).toISOString() // 40 min ago, daqi 10 — latest → written to state
      const existingStartedAt = new Date(
        Date.now() - 5 * 60 * 60 * 1000
      ).toISOString() // 5h ago — the original event start, within 24h window

      db._state.find.mockReturnValueOnce({
        sort: vi.fn(function () {
          return this
        }),
        toArray: vi.fn().mockResolvedValue([
          {
            samplingPointId: 77162,
            siteId: 'UKA00819',
            'process-status': 'processed',
            'alert-started-timestamp': existingStartedAt,
            lastUpdatedFromRicardo: existingStartedAt
          }
        ])
      })
      fetchDaqiAlerts.mockResolvedValueOnce({
        member: [
          { ...sampleAlert, date: olderReadingDate, daqi: 9 }, // older reading — wins
          { ...sampleAlert, date: latestReadingDate, daqi: 10 } // latest reading
        ]
      })

      await processDaqiAlerts(db)

      // Still within the 24h dedup window → no re-notification
      expect(sendNotification).not.toHaveBeenCalled()

      // lastUpdatedFromRicardo and daqi must reflect the LATEST reading
      // (latestReadingDate / daqi 10) so the state row tracks Ricardo's most
      // recent measurement, while alert-started-timestamp stays the event anchor.
      expect(db._state.updateOne).toHaveBeenCalledWith(
        {
          samplingPointId: 77162,
          'alert-started-timestamp': existingStartedAt
        },
        {
          $set: {
            lastUpdatedFromRicardo: latestReadingDate,
            daqi: 10
          }
        }
      )
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
