import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  collapseInCycleDuplicates,
  ensureCacheReadyForCycle,
  getMatchingUsers,
  sendNotificationsToUsers
} from './alertCycleUtils.js'

vi.mock('./ricardoSiteAndRegionCache.js', () => ({
  getSiteCacheSize: vi.fn(),
  ensureSiteCachePopulated: vi.fn()
}))

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const { getSiteCacheSize, ensureSiteCachePopulated } = await import(
  './ricardoSiteAndRegionCache.js'
)

describe('alertCycleUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('collapseInCycleDuplicates', () => {
    it('returns empty array for empty input', () => {
      expect(collapseInCycleDuplicates([])).toEqual([])
    })

    it('returns single-element array unchanged', () => {
      const a = { 'alert-id': 'a-1', date: '2024-01-01' }
      expect(collapseInCycleDuplicates([a])).toEqual([a])
    })

    it('deduplicates alerts with the same alert-id by default', () => {
      const a1 = { 'alert-id': 'id-1', val: 1 }
      const a2 = { 'alert-id': 'id-1', val: 2 }
      const a3 = { 'alert-id': 'id-2', val: 3 }
      expect(collapseInCycleDuplicates([a1, a2, a3])).toEqual([a1, a3])
    })

    it('keeps first occurrence when duplicates exist', () => {
      const first = { 'alert-id': 'dup', date: '08:00' }
      const second = { 'alert-id': 'dup', date: '09:00' }
      const result = collapseInCycleDuplicates([first, second])
      expect(result).toHaveLength(1)
      expect(result[0]).toBe(first)
    })

    it('uses custom keyFn when provided', () => {
      const a1 = { samplingPointId: 100, date: 'A' }
      const a2 = { samplingPointId: 100, date: 'B' }
      const a3 = { samplingPointId: 200, date: 'C' }
      const result = collapseInCycleDuplicates(
        [a1, a2, a3],
        (a) => a.samplingPointId
      )
      expect(result).toEqual([a1, a3])
    })

    it('preserves order for unique items', () => {
      const items = [
        { 'alert-id': 'z' },
        { 'alert-id': 'a' },
        { 'alert-id': 'm' }
      ]
      expect(collapseInCycleDuplicates(items)).toEqual(items)
    })
  })

  describe('ensureCacheReadyForCycle', () => {
    it('returns true when cache size > 0', async () => {
      getSiteCacheSize.mockReturnValue(5)
      const result = await ensureCacheReadyForCycle('[Test]')
      expect(result).toBe(true)
      expect(ensureSiteCachePopulated).not.toHaveBeenCalled()
    })

    it('returns true when cache is empty but refresh succeeds', async () => {
      getSiteCacheSize.mockReturnValue(0)
      ensureSiteCachePopulated.mockResolvedValue(true)
      const result = await ensureCacheReadyForCycle('[Test]')
      expect(result).toBe(true)
    })

    it('returns false when cache is empty and refresh fails', async () => {
      getSiteCacheSize.mockReturnValue(0)
      ensureSiteCachePopulated.mockResolvedValue(false)
      const result = await ensureCacheReadyForCycle('[Test]')
      expect(result).toBe(false)
    })
  })

  describe('getMatchingUsers', () => {
    it('returns empty array when no users', () => {
      expect(getMatchingUsers([], 'North East')).toEqual([])
    })

    it('returns empty array when no users have matching region', () => {
      const users = [
        {
          user_contact: 'u1',
          alertType: 'sms',
          lang: 'en',
          locations: [{ region: 'South East', location: 'Brighton' }]
        }
      ]
      expect(getMatchingUsers(users, 'North East')).toEqual([])
    })

    it('returns user-location pairs matching the region', () => {
      const users = [
        {
          user_contact: '+447700000001',
          alertType: 'sms',
          lang: 'en',
          locations: [
            { region: 'North East', location: 'Newcastle' },
            { region: 'South East', location: 'Brighton' }
          ]
        }
      ]
      const result = getMatchingUsers(users, 'North East')
      expect(result).toEqual([
        {
          userContact: '+447700000001',
          alertType: 'sms',
          location: 'Newcastle',
          lang: 'en'
        }
      ])
    })

    it('expands multiple users with multiple matching locations', () => {
      const users = [
        {
          user_contact: 'u1',
          alertType: 'sms',
          lang: 'cy',
          locations: [
            { region: 'North East', location: 'Durham' },
            { region: 'North East', location: 'Sunderland' }
          ]
        },
        {
          user_contact: 'u2',
          alertType: 'email',
          lang: 'en',
          locations: [{ region: 'North East', location: 'Newcastle' }]
        }
      ]
      const result = getMatchingUsers(users, 'North East')
      expect(result).toHaveLength(3)
    })

    it('defaults lang to en when not set on user', () => {
      const users = [
        {
          user_contact: 'u1',
          alertType: 'sms',
          locations: [{ region: 'North East', location: 'Newcastle' }]
        }
      ]
      const result = getMatchingUsers(users, 'North East')
      expect(result[0].lang).toBe('en')
    })

    it('handles user with no locations field', () => {
      const users = [{ user_contact: 'u1', alertType: 'sms' }]
      expect(getMatchingUsers(users, 'North East')).toEqual([])
    })
  })

  describe('sendNotificationsToUsers', () => {
    const makeOpts = (matchedUsers, sendAlert) => ({
      db: {},
      alertDetail: { 'alert-id': 'test-id-123', region: 'North East' },
      matchedUsers,
      logPrefix: '[Test]',
      insertAuditEntry: vi.fn().mockResolvedValue(undefined),
      updateAuditEntry: vi.fn().mockResolvedValue(undefined),
      sendAlert
    })

    it('returns true when there are no users to notify', async () => {
      const opts = makeOpts([], vi.fn())
      const result = await sendNotificationsToUsers(opts)
      expect(result).toBe(true)
    })

    it('sends notifications and returns true when all succeed', async () => {
      const sendAlert = vi.fn().mockResolvedValue('notif-abc')
      const user = {
        userContact: '+447700000001',
        alertType: 'sms',
        location: 'Newcastle',
        lang: 'en'
      }
      const opts = makeOpts([user], sendAlert)
      const result = await sendNotificationsToUsers(opts)

      expect(result).toBe(true)
      expect(opts.insertAuditEntry).toHaveBeenCalledWith(
        opts.db,
        opts.alertDetail,
        user
      )
      expect(sendAlert).toHaveBeenCalledWith(user, opts.alertDetail)
      expect(opts.updateAuditEntry).toHaveBeenCalledWith(
        opts.db,
        'test-id-123',
        user.userContact,
        user.location,
        'notif-abc'
      )
    })

    it('returns false and continues when one notification fails', async () => {
      const sendAlert = vi
        .fn()
        .mockRejectedValueOnce(new Error('Send failed'))
        .mockResolvedValue('notif-ok')

      const users = [
        { userContact: 'bad', alertType: 'sms', location: 'A', lang: 'en' },
        { userContact: 'good', alertType: 'sms', location: 'B', lang: 'en' }
      ]
      const opts = makeOpts(users, sendAlert)
      const result = await sendNotificationsToUsers(opts)

      expect(result).toBe(false)
      expect(sendAlert).toHaveBeenCalledTimes(2)
      // audit update only called for successful one
      expect(opts.updateAuditEntry).toHaveBeenCalledTimes(1)
    })

    it('returns true when all users receive notification', async () => {
      const sendAlert = vi
        .fn()
        .mockResolvedValueOnce('n1')
        .mockResolvedValueOnce('n2')

      const users = [
        { userContact: 'u1', alertType: 'sms', location: 'X', lang: 'en' },
        { userContact: 'u2', alertType: 'email', location: 'Y', lang: 'cy' }
      ]
      const opts = makeOpts(users, sendAlert)
      const result = await sendNotificationsToUsers(opts)

      expect(result).toBe(true)
      expect(opts.updateAuditEntry).toHaveBeenCalledTimes(2)
    })
  })
})
