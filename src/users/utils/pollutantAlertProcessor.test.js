import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  filterValidAlerts,
  getMatchingUsers,
  cleanPollutantName,
  formatLocationForUrl,
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
  getRegionForSite: vi.fn().mockReturnValue(null)
}))

describe('pollutantAlertProcessor', () => {
  describe('cleanPollutantName', () => {
    it('should strip HTML tags from pollutant name', () => {
      expect(cleanPollutantName('O<sub>3</sub> (O3)')).toBe('O3 (O3)')
    })

    it('should return plain text unchanged', () => {
      expect(cleanPollutantName('PM2.5')).toBe('PM2.5')
    })
  })

  describe('filterValidAlerts', () => {
    it('should filter alerts with alertLevel=true and validationStatus=2', () => {
      const members = [
        {
          samplingPointId: 331,
          siteId: 'UKA00339',
          region: 'Greater London',
          pollutant: 'O<sub>3</sub>',
          alertText: 'tbc',
          concentration: 168,
          alertThreshold: null,
          alertLevel: true,
          validationStatus: 2
        },
        {
          samplingPointId: 100,
          siteId: 'UKA00100',
          region: 'South East',
          pollutant: 'NO2',
          alertText: 'tbc',
          concentration: 50,
          alertThreshold: null,
          alertLevel: false,
          validationStatus: 2
        },
        {
          samplingPointId: 200,
          siteId: 'UKA00200',
          region: 'North West & Merseyside',
          pollutant: 'PM10',
          alertText: 'tbc',
          concentration: 80,
          alertThreshold: null,
          alertLevel: true,
          validationStatus: 1
        }
      ]

      const result = filterValidAlerts(members)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        'alert-id': 331,
        siteId: 'UKA00339',
        region: 'Greater London',
        pollutant: 'O<sub>3</sub>',
        alertText: 'tbc',
        concentration: 168,
        alertThreshold: null
      })
    })

    it('should return empty array when no alerts match', () => {
      const members = [
        {
          samplingPointId: 1,
          alertLevel: false,
          validationStatus: 2,
          region: 'X',
          pollutant: 'X',
          alertText: '',
          concentration: 0,
          alertThreshold: null
        }
      ]
      expect(filterValidAlerts(members)).toHaveLength(0)
    })

    it('should include alert when alertLevel=false but informationLevel=true', () => {
      const members = [
        {
          samplingPointId: 500,
          siteId: 'UKA00500',
          region: 'South East',
          pollutant: 'NO2',
          alertText: '',
          concentration: 50,
          alertThreshold: null,
          alertLevel: false,
          informationLevel: true,
          validationStatus: 2
        }
      ]
      const result = filterValidAlerts(members)
      expect(result).toHaveLength(1)
      expect(result[0]['alert-id']).toBe(500)
    })

    it('should exclude alert when both alertLevel and informationLevel are false', () => {
      const members = [
        {
          samplingPointId: 501,
          siteId: 'UKA00501',
          region: 'South East',
          pollutant: 'NO2',
          alertText: '',
          concentration: 50,
          alertThreshold: null,
          alertLevel: false,
          informationLevel: false,
          validationStatus: 2
        }
      ]
      expect(filterValidAlerts(members)).toHaveLength(0)
    })
  })

  describe('formatLocationForUrl', () => {
    it('should convert comma-separated location to slug', () => {
      expect(formatLocationForUrl('Reading, Reading')).toBe('reading_reading')
    })

    it('should handle multi-word parts with hyphens', () => {
      expect(formatLocationForUrl('Bristol, City of Bristol')).toBe(
        'bristol_city-of-bristol'
      )
      expect(formatLocationForUrl('Stockland Bristol, Somerset')).toBe(
        'stockland-bristol_somerset'
      )
      expect(formatLocationForUrl('Bristol Airport, North Somerset')).toBe(
        'bristol-airport_north-somerset'
      )
    })

    it('should handle postcodes by removing spaces and lowercasing', () => {
      expect(formatLocationForUrl('tw183ht')).toBe('tw183ht')
      expect(formatLocationForUrl('TW183HT')).toBe('tw183ht')
      expect(formatLocationForUrl('TW18 3HT')).toBe('tw183ht')
      expect(formatLocationForUrl('tw18 3ht')).toBe('tw183ht')
    })

    it('should return empty string for falsy input', () => {
      expect(formatLocationForUrl('')).toBe('')
      expect(formatLocationForUrl(null)).toBe('')
      expect(formatLocationForUrl(undefined)).toBe('')
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
      const result = getMatchingUsers(users, 'Wales')
      expect(result).toHaveLength(0)
    })

    it('should handle users with no locations', () => {
      const usersNoLoc = [
        { user_contact: '+447111111111', alertType: 'sms', locations: [] }
      ]
      expect(getMatchingUsers(usersNoLoc, 'Greater London')).toHaveLength(0)
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

    it('should default lang to en when userMatch has no lang', async () => {
      const mockSend = vi.mocked(
        (await import('./notifyServiceClient.js')).sendNotification
      )
      mockSend.mockResolvedValue({ notificationId: 'notif-default-lang' })

      const userMatch = {
        userContact: '+447000000001',
        alertType: 'sms',
        location: 'London'
        // no lang property
      }
      const alertDetail = {
        'alert-id': 999,
        region: 'England',
        pollutant: 'O3',
        concentration: 100
      }

      const result = await sendAlertToUser(userMatch, alertDetail)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'sms-template-id',
          personalisation: expect.objectContaining({
            checkAirQualityLink: expect.stringContaining('?lang=en')
          })
        }),
        expect.any(String)
      )
      expect(result).toBe('notif-default-lang')
    })
  })

  describe('processPollutantAlerts', () => {
    let mockDb
    let mockFetchAlerts
    let mockSendNotification

    beforeEach(async () => {
      vi.clearAllMocks()
      mockFetchAlerts = vi.mocked(
        (await import('./ricardoApiClient.js')).fetchAlerts
      )
      mockSendNotification = vi.mocked(
        (await import('./notifyServiceClient.js')).sendNotification
      )

      mockDb = {
        collection: vi.fn()
      }
    })

    it('should skip processing when fetch fails', async () => {
      mockFetchAlerts.mockRejectedValue(new Error('Network error'))

      await processPollutantAlerts(mockDb)

      expect(mockDb.collection).not.toHaveBeenCalled()
    })

    it('should handle response body without member property', async () => {
      mockFetchAlerts.mockResolvedValue({})

      await processPollutantAlerts(mockDb)

      expect(mockDb.collection).not.toHaveBeenCalled()
    })

    it('should skip processing when no members returned', async () => {
      mockFetchAlerts.mockResolvedValue({ member: [] })

      await processPollutantAlerts(mockDb)

      expect(mockDb.collection).not.toHaveBeenCalled()
    })

    it('should skip processing when members exist but none pass filter', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 1,
            region: 'X',
            pollutant: 'X',
            alertText: '',
            concentration: 0,
            alertThreshold: null,
            alertLevel: false,
            validationStatus: 2
          }
        ]
      })

      await processPollutantAlerts(mockDb)

      expect(mockDb.collection).not.toHaveBeenCalled()
    })

    it('should skip already processed alerts', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 331,
            region: 'Greater London',
            pollutant: 'O3',
            alertText: 'tbc',
            concentration: 168,
            alertThreshold: null,
            alertLevel: true,
            validationStatus: 2
          }
        ]
      })

      const alertDetailsColl = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi
              .fn()
              .mockResolvedValue([{ 'alert-id': 331, status: 'processed' }])
          })
        })
      }

      mockDb.collection.mockImplementation((name) => {
        if (name === 'pollutant-alert-processing-state') return alertDetailsColl
        return null
      })

      await processPollutantAlerts(mockDb)

      expect(alertDetailsColl.find).toHaveBeenCalled()
    })

    it('should process new alerts and send notifications', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 500,
            region: 'England',
            pollutant: 'O<sub>3</sub> (O3)',
            alertText: 'High ozone',
            concentration: 180,
            alertThreshold: 150,
            alertLevel: true,
            validationStatus: 2
          }
        ]
      })

      const alertDetailsColl = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([])
          })
        }),
        updateOne: vi.fn().mockResolvedValue({})
      }

      const usersColl = {
        find: vi.fn().mockReturnValue({
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
        })
      }

      const auditColl = {
        insertOne: vi.fn().mockResolvedValue({}),
        updateOne: vi.fn().mockResolvedValue({})
      }

      mockDb.collection.mockImplementation((name) => {
        if (name === 'pollutant-alert-processing-state') return alertDetailsColl
        if (name === 'USERS') return usersColl
        if (name === 'pollutant-alerts-audit') return auditColl
        return null
      })

      mockSendNotification.mockResolvedValue({ notificationId: 'notif-123' })

      await processPollutantAlerts(mockDb)

      // Should mark in-progress
      expect(alertDetailsColl.updateOne).toHaveBeenCalledWith(
        { 'alert-id': 500 },
        expect.objectContaining({
          $set: expect.objectContaining({
            'alert-id': 500,
            status: 'in-progress'
          })
        }),
        { upsert: true }
      )

      // Should send notification with checkAirQualityLink
      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: '+447123456789',
          templateId: 'sms-template-id',
          alertId: '500',
          personalisation: {
            location: 'Bristol, City of Bristol',
            concentration: '180',
            Pollutant: 'O3 (O3)',
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/bristol_city-of-bristol?lang=en'
          }
        }),
        expect.stringContaining('alert-500')
      )

      // Should mark processed
      expect(alertDetailsColl.updateOne).toHaveBeenCalledWith(
        { 'alert-id': 500 },
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'processed' })
        })
      )
    })

    it('should send email notification with emailAddress field', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 600,
            region: 'Scotland',
            pollutant: 'PM2.5',
            alertText: 'tbc',
            concentration: 90,
            alertThreshold: null,
            alertLevel: true,
            validationStatus: 2
          }
        ]
      })

      const alertDetailsColl = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([])
          })
        }),
        updateOne: vi.fn().mockResolvedValue({})
      }

      const usersColl = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              user_contact: 'user@test.com',
              alertType: 'email',
              lang: 'cy',
              locations: [{ location: 'Edinburgh', region: 'Scotland' }]
            }
          ])
        })
      }

      const auditColl = {
        insertOne: vi.fn().mockResolvedValue({}),
        updateOne: vi.fn().mockResolvedValue({})
      }

      mockDb.collection.mockImplementation((name) => {
        if (name === 'pollutant-alert-processing-state') return alertDetailsColl
        if (name === 'USERS') return usersColl
        if (name === 'pollutant-alerts-audit') return auditColl
        return null
      })

      mockSendNotification.mockResolvedValue({})

      await processPollutantAlerts(mockDb)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAddress: 'user@test.com',
          templateId: 'email-template-id-cy',
          alertId: '600',
          personalisation: expect.objectContaining({
            checkAirQualityLink:
              'https://check-air-quality.service.gov.uk/location/edinburgh?lang=cy',
            unsubscribeLink:
              'https://aqie-front-end.test.cdp-int.defra.cloud/notify/unsubscribe-email-link?email=user%40test.com'
          })
        }),
        expect.any(String)
      )
    })

    it('should log error and continue when markAlertInProgress throws', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 800,
            region: 'England',
            pollutant: 'NO2',
            alertText: 'tbc',
            concentration: 50,
            alertThreshold: null,
            alertLevel: true,
            validationStatus: 2
          }
        ]
      })

      const alertDetailsColl = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([])
          })
        }),
        updateOne: vi.fn().mockRejectedValue(new Error('DB write error'))
      }

      mockDb.collection.mockImplementation((name) => {
        if (name === 'pollutant-alert-processing-state') return alertDetailsColl
        return null
      })

      // Should not throw — outer catch handles it
      await expect(processPollutantAlerts(mockDb)).resolves.not.toThrow()
    })

    it('should log warning and continue when audit insert has duplicate key (11000)', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 900,
            region: 'England',
            pollutant: 'PM2.5',
            alertText: 'tbc',
            concentration: 55,
            alertThreshold: null,
            alertLevel: true,
            validationStatus: 2
          }
        ]
      })

      const alertDetailsColl = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([])
          })
        }),
        updateOne: vi.fn().mockResolvedValue({})
      }

      const usersColl = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              user_contact: '+447333333333',
              alertType: 'sms',
              locations: [{ location: 'Manchester', region: 'England' }]
            }
          ])
        })
      }

      const dupError = Object.assign(new Error('E11000 duplicate key error'), {
        code: 11000
      })
      const auditColl = {
        insertOne: vi.fn().mockRejectedValue(dupError),
        updateOne: vi.fn().mockResolvedValue({})
      }

      mockDb.collection.mockImplementation((name) => {
        if (name === 'pollutant-alert-processing-state') return alertDetailsColl
        if (name === 'USERS') return usersColl
        if (name === 'pollutant-alerts-audit') return auditColl
        return null
      })

      mockSendNotification.mockResolvedValue({ notificationId: 'notif-dup' })

      // Should not throw — duplicate key is handled gracefully
      await expect(processPollutantAlerts(mockDb)).resolves.not.toThrow()
    })

    it('should catch outer error when audit insert fails with non-11000 code', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 901,
            region: 'England',
            pollutant: 'PM10',
            alertText: 'tbc',
            concentration: 70,
            alertThreshold: null,
            alertLevel: true,
            validationStatus: 2
          }
        ]
      })

      const alertDetailsColl = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([])
          })
        }),
        updateOne: vi.fn().mockResolvedValue({})
      }

      const usersColl = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              user_contact: '+447444444444',
              alertType: 'sms',
              locations: [{ location: 'Leeds', region: 'England' }]
            }
          ])
        })
      }

      const dbError = Object.assign(new Error('Write conflict'), { code: 112 })
      const auditColl = {
        insertOne: vi.fn().mockRejectedValue(dbError),
        updateOne: vi.fn().mockResolvedValue({})
      }

      mockDb.collection.mockImplementation((name) => {
        if (name === 'pollutant-alert-processing-state') return alertDetailsColl
        if (name === 'USERS') return usersColl
        if (name === 'pollutant-alerts-audit') return auditColl
        return null
      })

      // Non-11000 error propagates to outer catch which logs and continues
      await expect(processPollutantAlerts(mockDb)).resolves.not.toThrow()
    })

    it('should send Welsh SMS notification using smsAlertCy template', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 950,
            region: 'Wales',
            pollutant: 'NO2',
            alertText: 'tbc',
            concentration: 75,
            alertThreshold: null,
            alertLevel: true,
            validationStatus: 2
          }
        ]
      })

      const alertDetailsColl = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([])
          })
        }),
        updateOne: vi.fn().mockResolvedValue({})
      }

      const usersColl = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              user_contact: '+447888888888',
              alertType: 'sms',
              lang: 'cy',
              locations: [{ location: 'Cardiff', region: 'Wales' }]
            }
          ])
        })
      }

      const auditColl = {
        insertOne: vi.fn().mockResolvedValue({}),
        updateOne: vi.fn().mockResolvedValue({})
      }

      mockDb.collection.mockImplementation((name) => {
        if (name === 'pollutant-alert-processing-state') return alertDetailsColl
        if (name === 'USERS') return usersColl
        if (name === 'pollutant-alerts-audit') return auditColl
        return null
      })

      mockSendNotification.mockResolvedValue({ notificationId: 'notif-cy-sms' })

      await processPollutantAlerts(mockDb)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'sms-template-id-cy'
        }),
        expect.any(String)
      )
    })

    it('should send English email notification using emailAlert template', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 951,
            region: 'England',
            pollutant: 'PM10',
            alertText: 'tbc',
            concentration: 80,
            alertThreshold: null,
            alertLevel: true,
            validationStatus: 2
          }
        ]
      })

      const alertDetailsColl = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([])
          })
        }),
        updateOne: vi.fn().mockResolvedValue({})
      }

      const usersColl = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              user_contact: 'en-user@test.com',
              alertType: 'email',
              lang: 'en',
              locations: [{ location: 'Reading', region: 'England' }]
            }
          ])
        })
      }

      const auditColl = {
        insertOne: vi.fn().mockResolvedValue({}),
        updateOne: vi.fn().mockResolvedValue({})
      }

      mockDb.collection.mockImplementation((name) => {
        if (name === 'pollutant-alert-processing-state') return alertDetailsColl
        if (name === 'USERS') return usersColl
        if (name === 'pollutant-alerts-audit') return auditColl
        return null
      })

      mockSendNotification.mockResolvedValue({
        notificationId: 'notif-en-email'
      })

      await processPollutantAlerts(mockDb)

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAddress: 'en-user@test.com',
          templateId: 'email-template-id'
        }),
        expect.any(String)
      )
    })

    it('should not mark alert as processed when notification fails', async () => {
      mockFetchAlerts.mockResolvedValue({
        member: [
          {
            samplingPointId: 700,
            region: 'Wales',
            pollutant: 'NO2',
            alertText: 'tbc',
            concentration: 100,
            alertThreshold: null,
            alertLevel: true,
            validationStatus: 2
          }
        ]
      })

      const alertDetailsColl = {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([])
          })
        }),
        updateOne: vi.fn().mockResolvedValue({})
      }

      const usersColl = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              user_contact: '+447111111111',
              alertType: 'sms',
              locations: [{ location: 'Cardiff', region: 'Wales' }]
            }
          ])
        })
      }

      const auditColl = {
        insertOne: vi.fn().mockResolvedValue({}),
        updateOne: vi.fn().mockResolvedValue({})
      }

      mockDb.collection.mockImplementation((name) => {
        if (name === 'pollutant-alert-processing-state') return alertDetailsColl
        if (name === 'USERS') return usersColl
        if (name === 'pollutant-alerts-audit') return auditColl
        return null
      })

      mockSendNotification.mockRejectedValue(new Error('Send failed'))

      await processPollutantAlerts(mockDb)

      // Should have called updateOne for in-progress but NOT for processed
      const processedCalls = alertDetailsColl.updateOne.mock.calls.filter(
        (call) => call[1].$set.status === 'processed'
      )
      expect(processedCalls).toHaveLength(0)
    })
  })
})
