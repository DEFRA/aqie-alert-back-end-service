import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  filterValidAlerts,
  getMatchingUsers,
  cleanPollutantName,
  formatPollutantName,
  buildAuditKey,
  sendAlertToUser,
  processPollutantAlerts
} from './pollutantAlertProcessor.js'

vi.mock('./ricardoApiClient.js', () => ({
  fetchAlerts: vi.fn()
}))

vi.mock('./notifyServiceClient.js', () => ({
  sendNotification: vi.fn()
}))

vi.mock('../../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      const values = {
        'alertTemplates.smsAlert': 'sms-template-id',
        'alertTemplates.smsAlertCy': 'sms-template-id-cy',
        'alertTemplates.emailAlert': 'email-template-id',
        'alertTemplates.emailAlertCy': 'email-template-id-cy',
        'notification.templates.unsubscribeEmailLink':
          'https://aqie-front-end.test.cdp-int.defra.cloud/notify/unsubscribe-email-link',
        'alertTemplates.checkAirQualityLink':
          'https://check-air-quality.service.gov.uk/location/'
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

vi.mock('./maskingUtils.js', () => ({
  maskPhoneNumber: vi.fn((v) => v),
  maskEmail: vi.fn((v) => v),
  maskTemplateId: vi.fn((v) => v)
}))

vi.mock('./ricardoSiteAndRegionCache.js', () => ({
  getRegionForSite: vi.fn().mockReturnValue(null),
  getSiteCacheSize: vi.fn().mockReturnValue(1),
  ensureSiteCachePopulated: vi.fn().mockResolvedValue(true)
}))

const { fetchAlerts } = await import('./ricardoApiClient.js')
const { sendNotification } = await import('./notifyServiceClient.js')
const { getRegionForSite, getSiteCacheSize, ensureSiteCachePopulated } =
  await import('./ricardoSiteAndRegionCache.js')

// 1h ago — within the 24h window enforced by filterValidAlerts.
const SAMPLE_DATE = new Date(Date.now() - 60 * 60 * 1000).toISOString()

const sampleMember = {
  samplingPointId: 500,
  siteId: 'UKA00500',
  region: 'England',
  pollutant: 'O<sub>3</sub> (O3)',
  concentration: 180,
  alertThreshold: 150,
  alertLevel: true,
  validationStatus: 2,
  date: SAMPLE_DATE
}

describe('pollutantAlertProcessor', () => {
  describe('cleanPollutantName', () => {
    it('should strip HTML tags from pollutant name', () => {
      expect(cleanPollutantName('O<sub>3</sub> (O3)')).toBe('O3 (O3)')
    })

    it('should return plain text unchanged', () => {
      expect(cleanPollutantName('PM2.5')).toBe('PM2.5')
    })
  })

  describe('formatPollutantName', () => {
    it('should map O3 code to ozone', () => {
      expect(formatPollutantName('O<sub>3</sub> (O3)')).toBe('ozone (O3)')
    })

    it('should map NO2 code to nitrogen dioxide', () => {
      expect(formatPollutantName('NO<sub>2</sub> (NO2)')).toBe(
        'nitrogen dioxide (NO2)'
      )
    })

    it('should map SO2 code to sulphur dioxide', () => {
      expect(formatPollutantName('SO<sub>2</sub> (SO2)')).toBe(
        'sulphur dioxide (SO2)'
      )
    })

    it('should return cleaned string unchanged when code is not in the map', () => {
      expect(formatPollutantName('XYZ (UNKNOWN)')).toBe('XYZ (UNKNOWN)')
    })

    it('should return cleaned string unchanged when there are no parentheses', () => {
      expect(formatPollutantName('PM2.5')).toBe('PM2.5')
    })
  })

  describe('buildAuditKey', () => {
    it('combines samplingPointId and date (no siteId)', () => {
      expect(buildAuditKey(sampleMember)).toBe(`500-${SAMPLE_DATE}`)
    })
  })

  describe('filterValidAlerts', () => {
    it('keeps alerts with alertLevel=true, validationStatus=2 and a recent date', () => {
      const members = [
        sampleMember,
        {
          ...sampleMember,
          samplingPointId: 100,
          siteId: 'UKA00100',
          alertLevel: false,
          informationLevel: false
        },
        {
          ...sampleMember,
          samplingPointId: 200,
          siteId: 'UKA00200',
          validationStatus: 1
        }
      ]

      const result = filterValidAlerts(members)

      expect(result).toHaveLength(1)
      // Ricardo's `region` is deliberately dropped; region is resolved from
      // siteId via the cache later in processAlertForUsers. `alert-id` becomes
      // the per-emission composite; samplingPointId is carried for the state key.
      expect(result[0]).toEqual({
        samplingPointId: 500,
        'alert-id': `500-${SAMPLE_DATE}`,
        siteId: 'UKA00500',
        date: SAMPLE_DATE,
        pollutant: 'O<sub>3</sub> (O3)',
        concentration: 180,
        alertThreshold: 150
      })
    })

    it('includes an alert when alertLevel=false but informationLevel=true', () => {
      const members = [
        {
          ...sampleMember,
          samplingPointId: 501,
          siteId: 'UKA00501',
          alertLevel: false,
          informationLevel: true
        }
      ]
      const result = filterValidAlerts(members)
      expect(result).toHaveLength(1)
      expect(result[0]['alert-id']).toBe(`501-${SAMPLE_DATE}`)
    })

    it('excludes an alert when both alertLevel and informationLevel are false', () => {
      const members = [
        {
          ...sampleMember,
          alertLevel: false,
          informationLevel: false
        }
      ]
      expect(filterValidAlerts(members)).toHaveLength(0)
    })

    it('drops entries missing samplingPointId, siteId, or date', () => {
      const members = [
        { ...sampleMember, samplingPointId: undefined },
        { ...sampleMember, siteId: '' },
        { ...sampleMember, date: '' }
      ]
      expect(filterValidAlerts(members)).toHaveLength(0)
    })

    it('drops entries whose date is older than 24h', () => {
      const stale = {
        ...sampleMember,
        date: '2025-12-04T02:00:00+01:00'
      }
      expect(filterValidAlerts([stale])).toHaveLength(0)
    })
  })

  describe('getMatchingUsers', () => {
    const users = [
      {
        user_contact: '+447123456789',
        alertType: 'sms',
        lang: 'en',
        locations: [
          { location: 'London', region: 'Greater London' },
          { location: 'Bristol', region: 'South West' }
        ]
      },
      {
        user_contact: 'user@test.com',
        alertType: 'email',
        lang: 'cy',
        locations: [
          { location: 'Manchester', region: 'North West' },
          { location: 'Leeds', region: 'North West' }
        ]
      },
      {
        user_contact: '+447999999999',
        alertType: 'sms',
        locations: [{ location: 'Edinburgh', region: 'Scotland' }]
      }
    ]

    it('should match users by region and include lang', () => {
      const result = getMatchingUsers(users, 'Greater London')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        userContact: '+447123456789',
        alertType: 'sms',
        location: 'London',
        lang: 'en'
      })
    })

    it('should return multiple entries for user with multiple locations in same region', () => {
      const result = getMatchingUsers(users, 'North West')
      expect(result).toHaveLength(2)
      expect(result[0].location).toBe('Manchester')
      expect(result[0].lang).toBe('cy')
      expect(result[1].location).toBe('Leeds')
    })

    it('should default lang to en when not set on user', () => {
      const result = getMatchingUsers(users, 'Scotland')
      expect(result).toHaveLength(1)
      expect(result[0].lang).toBe('en')
    })

    it('should return empty array when no users match', () => {
      expect(getMatchingUsers(users, 'Wales')).toHaveLength(0)
    })

    it('should handle users with undefined locations property', () => {
      const usersNoLoc = [{ user_contact: '+447111111111', alertType: 'sms' }]
      expect(getMatchingUsers(usersNoLoc, 'Greater London')).toHaveLength(0)
    })
  })

  describe('sendAlertToUser', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('sends an SMS with the composite alertId and English template', async () => {
      sendNotification.mockResolvedValue({ notificationId: 'notif-123' })

      const result = await sendAlertToUser(
        { userContact: '+447000000001', alertType: 'sms', location: 'London' },
        {
          'alert-id': `999-${SAMPLE_DATE}`,
          region: 'England',
          pollutant: 'O<sub>3</sub> (O3)',
          concentration: 100
        }
      )

      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'sms-template-id',
          alertId: `999-${SAMPLE_DATE}`,
          personalisation: expect.objectContaining({
            Pollutant: 'ozone (O3)',
            concentration: '100',
            checkAirQualityLink: expect.stringContaining('?lang=en')
          })
        }),
        expect.stringContaining('alert-999-')
      )
      expect(result).toBe('notif-123')
    })
  })

  describe('processPollutantAlerts', () => {
    function makeDb() {
      const stateCollection = {
        find: vi.fn(() => ({
          sort: vi.fn(function () {
            return this
          }),
          toArray: vi.fn().mockResolvedValue([])
        })),
        updateOne: vi.fn().mockResolvedValue({})
      }
      const auditCollection = {
        insertOne: vi.fn().mockResolvedValue({}),
        updateOne: vi.fn().mockResolvedValue({})
      }
      const usersCollection = {
        find: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([
            {
              user_contact: '+447123456789',
              alertType: 'sms',
              lang: 'en',
              locations: [
                { location: 'Bristol, City of Bristol', region: 'England' }
              ]
            }
          ])
        }))
      }
      return {
        collection: vi.fn((name) => {
          if (name === 'pollutant-alert-processing-state') {
            return stateCollection
          }
          if (name === 'pollutant-alerts-audit') {
            return auditCollection
          }
          if (name === 'USERS') {
            return usersCollection
          }
          return null
        }),
        _state: stateCollection,
        _audit: auditCollection,
        _users: usersCollection
      }
    }

    beforeEach(() => {
      vi.clearAllMocks()
      getRegionForSite.mockReturnValue('England')
      getSiteCacheSize.mockReturnValue(1)
      ensureSiteCachePopulated.mockResolvedValue(true)
    })

    it('skips processing when fetch fails', async () => {
      const db = makeDb()
      fetchAlerts.mockRejectedValueOnce(new Error('Network error'))

      await processPollutantAlerts(db)

      expect(db._state.updateOne).not.toHaveBeenCalled()
      expect(sendNotification).not.toHaveBeenCalled()
    })

    it('skips processing when response body has no member property', async () => {
      const db = makeDb()
      fetchAlerts.mockResolvedValueOnce({})

      await processPollutantAlerts(db)

      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('skips processing when no members returned', async () => {
      const db = makeDb()
      fetchAlerts.mockResolvedValueOnce({ member: [] })

      await processPollutantAlerts(db)

      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('skips processing when members exist but none pass the filter', async () => {
      const db = makeDb()
      fetchAlerts.mockResolvedValueOnce({
        member: [
          { ...sampleMember, alertLevel: false, informationLevel: false }
        ]
      })

      await processPollutantAlerts(db)

      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('processes a new alert: marks in-progress (compound key), sends, marks processed, writes composite audit id', async () => {
      const db = makeDb()
      fetchAlerts.mockResolvedValueOnce({ member: [sampleMember] })
      sendNotification.mockResolvedValueOnce({ notificationId: 'notif-1' })

      await processPollutantAlerts(db)

      // in-progress upsert keyed on { alert-id (=samplingPointId), alert-started-timestamp }
      expect(db._state.updateOne).toHaveBeenCalledWith(
        { 'alert-id': 500, 'alert-started-timestamp': SAMPLE_DATE },
        {
          $set: {
            'alert-id': 500,
            siteId: 'UKA00500',
            region: 'England',
            pollutant: 'O<sub>3</sub> (O3)',
            concentration: 180,
            alertThreshold: 150,
            lastUpdatedFromRicardo: expect.any(String),
            status: 'in-progress',
            'alert-started-timestamp': SAMPLE_DATE
          },
          $setOnInsert: { createdAt: expect.any(Date) }
        },
        { upsert: true }
      )

      // audit row carries the composite (per-emission) alert-id
      expect(db._audit.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          'alert-id': `500-${SAMPLE_DATE}`,
          'pollutant-alert-status': 'not-processed',
          notificationId: null
        })
      )

      expect(sendNotification).toHaveBeenCalledTimes(1)

      expect(db._audit.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          'alert-id': `500-${SAMPLE_DATE}`,
          'pollutant-alert-status': 'not-processed'
        }),
        {
          $set: {
            'pollutant-alert-status': 'processed',
            notificationId: 'notif-1'
          }
        }
      )

      // final state flip to processed on the same compound key
      expect(db._state.updateOne).toHaveBeenLastCalledWith(
        { 'alert-id': 500, 'alert-started-timestamp': SAMPLE_DATE },
        { $set: { status: 'processed', processedAt: expect.any(Date) } }
      )
    })

    it('does NOT re-notify when the combo was last seen within 24h (update-only)', async () => {
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
            'alert-id': 500,
            status: 'processed',
            'alert-started-timestamp': fiveHoursAgo,
            lastUpdatedFromRicardo: fiveHoursAgo
          }
        ])
      })
      fetchAlerts.mockResolvedValueOnce({ member: [sampleMember] })

      await processPollutantAlerts(db)

      expect(sendNotification).not.toHaveBeenCalled()
      // bumps lastUpdatedFromRicardo on the existing event row
      expect(db._state.updateOne).toHaveBeenCalledWith(
        { 'alert-id': 500, 'alert-started-timestamp': fiveHoursAgo },
        {
          $set: {
            lastUpdatedFromRicardo: expect.any(String),
            concentration: 180
          }
        }
      )
    })

    it('re-notifies when the combo has been quiet for more than 24h', async () => {
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
            'alert-id': 500,
            status: 'processed',
            'alert-started-timestamp': twentyFiveHoursAgo,
            lastUpdatedFromRicardo: twentyFiveHoursAgo
          }
        ])
      })
      fetchAlerts.mockResolvedValueOnce({ member: [sampleMember] })
      sendNotification.mockResolvedValueOnce({ notificationId: 'notif-next' })

      await processPollutantAlerts(db)

      expect(sendNotification).toHaveBeenCalledTimes(1)
    })

    it('skips a combo left in-progress by a prior crashed cycle', async () => {
      const db = makeDb()
      db._state.find.mockReturnValueOnce({
        sort: vi.fn(function () {
          return this
        }),
        toArray: vi
          .fn()
          .mockResolvedValue([{ 'alert-id': 500, status: 'in-progress' }])
      })
      fetchAlerts.mockResolvedValueOnce({ member: [sampleMember] })

      await processPollutantAlerts(db)

      expect(sendNotification).not.toHaveBeenCalled()
      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('collapses same-samplingPointId rows in one cycle, oldest date wins', async () => {
      const db = makeDb()
      const t2 = new Date(Date.now() - 50 * 60 * 1000).toISOString()
      const t3 = new Date(Date.now() - 40 * 60 * 1000).toISOString()
      fetchAlerts.mockResolvedValueOnce({
        member: [
          sampleMember, // ~60 min ago, concentration 180 — oldest → wins
          { ...sampleMember, date: t2, concentration: 185 },
          { ...sampleMember, date: t3, concentration: 182 }
        ]
      })
      sendNotification.mockResolvedValue({ notificationId: 'notif-x' })

      await processPollutantAlerts(db)

      expect(sendNotification).toHaveBeenCalledTimes(1)
      // oldest reading (SAMPLE_DATE, concentration 180) is carried through
      expect(db._state.updateOne).toHaveBeenCalledWith(
        { 'alert-id': 500, 'alert-started-timestamp': SAMPLE_DATE },
        expect.objectContaining({
          $set: expect.objectContaining({
            'alert-started-timestamp': SAMPLE_DATE,
            concentration: 180,
            lastUpdatedFromRicardo: expect.any(String)
          })
        }),
        { upsert: true }
      )
      const concentrationsSent = sendNotification.mock.calls.map(
        (call) => call[0].personalisation.concentration
      )
      expect(concentrationsSent).toEqual(['180'])
    })

    it('sends a Welsh email with unsubscribe link and the composite alertId', async () => {
      const db = makeDb()
      getRegionForSite.mockReturnValue('Scotland')
      db._users.find.mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            user_contact: 'user@test.com',
            alertType: 'email',
            lang: 'cy',
            locations: [{ location: 'Edinburgh', region: 'Scotland' }]
          }
        ])
      })
      fetchAlerts.mockResolvedValueOnce({
        member: [{ ...sampleMember, samplingPointId: 600, siteId: 'UKA00600' }]
      })
      sendNotification.mockResolvedValue({})

      await processPollutantAlerts(db)

      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAddress: 'user@test.com',
          templateId: 'email-template-id-cy',
          alertId: `600-${SAMPLE_DATE}`,
          personalisation: expect.objectContaining({
            unsubscribeLink:
              'https://aqie-front-end.test.cdp-int.defra.cloud/notify/unsubscribe-email-link?email=user%40test.com'
          })
        }),
        expect.any(String)
      )
    })

    it('does not mark processed when a notification fails', async () => {
      const db = makeDb()
      fetchAlerts.mockResolvedValueOnce({ member: [sampleMember] })
      sendNotification.mockRejectedValue(new Error('Send failed'))

      await processPollutantAlerts(db)

      const processedCalls = db._state.updateOne.mock.calls.filter(
        (call) => call[1].$set?.status === 'processed'
      )
      expect(processedCalls).toHaveLength(0)
    })

    it('logs a warning and continues when audit insert hits a duplicate key (11000)', async () => {
      const db = makeDb()
      const dupError = Object.assign(new Error('E11000 duplicate key error'), {
        code: 11000
      })
      db._audit.insertOne.mockRejectedValue(dupError)
      fetchAlerts.mockResolvedValueOnce({ member: [sampleMember] })
      sendNotification.mockResolvedValue({ notificationId: 'notif-dup' })

      await expect(processPollutantAlerts(db)).resolves.not.toThrow()
      expect(sendNotification).toHaveBeenCalledTimes(1)
    })

    it('catches an outer error when audit insert fails with a non-11000 code', async () => {
      const db = makeDb()
      const dbError = Object.assign(new Error('Write conflict'), { code: 112 })
      db._audit.insertOne.mockRejectedValue(dbError)
      fetchAlerts.mockResolvedValueOnce({ member: [sampleMember] })

      await expect(processPollutantAlerts(db)).resolves.not.toThrow()
    })

    it('skips an alert whose siteId is not in the site cache (no notification)', async () => {
      const db = makeDb()
      getRegionForSite.mockReturnValue(null)
      fetchAlerts.mockResolvedValueOnce({
        member: [{ ...sampleMember, siteId: 'UKA-UNKNOWN' }]
      })

      await processPollutantAlerts(db)

      expect(sendNotification).not.toHaveBeenCalled()
      expect(db._state.updateOne).not.toHaveBeenCalled()
    })

    it('skips the cycle when the site cache is empty and refresh fails', async () => {
      const db = makeDb()
      getSiteCacheSize.mockReturnValue(0)
      ensureSiteCachePopulated.mockResolvedValue(false)
      fetchAlerts.mockResolvedValueOnce({ member: [sampleMember] })

      await processPollutantAlerts(db)

      expect(ensureSiteCachePopulated).toHaveBeenCalled()
      expect(sendNotification).not.toHaveBeenCalled()
      expect(db._state.updateOne).not.toHaveBeenCalled()
    })
  })
})
