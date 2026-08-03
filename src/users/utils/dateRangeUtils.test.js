import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isWithinLast24Hours,
  getRollingDayWindow,
  applyOffsetToTimestamp,
  TWENTY_FOUR_HOURS_MS
} from './dateRangeUtils.js'

describe('dateRangeUtils', () => {
  describe('TWENTY_FOUR_HOURS_MS', () => {
    it('equals 86400000 ms', () => {
      expect(TWENTY_FOUR_HOURS_MS).toBe(86_400_000)
    })
  })

  describe('isWithinLast24Hours', () => {
    it('returns true for a date 1 hour ago', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      expect(isWithinLast24Hours(oneHourAgo)).toBe(true)
    })

    it('returns true for a date exactly 23h 59m ago', () => {
      const almostExpired = new Date(
        Date.now() - (24 * 60 * 60 * 1000 - 60 * 1000)
      ).toISOString()
      expect(isWithinLast24Hours(almostExpired)).toBe(true)
    })

    it('returns false for a date 25 hours ago', () => {
      const tooOld = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      expect(isWithinLast24Hours(tooOld)).toBe(false)
    })

    it('returns false for a future date', () => {
      const future = new Date(Date.now() + 60 * 1000).toISOString()
      expect(isWithinLast24Hours(future)).toBe(false)
    })

    it('returns false for an invalid date string', () => {
      expect(isWithinLast24Hours('not-a-date')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isWithinLast24Hours('')).toBe(false)
    })

    it('returns false for null', () => {
      expect(isWithinLast24Hours(null)).toBe(false)
    })

    it('returns true for a date just now (0ms ago)', () => {
      const now = new Date().toISOString()
      expect(isWithinLast24Hours(now)).toBe(true)
    })
  })

  describe('getRollingDayWindow', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns startDate and endDate as YYYY-MM-DD strings', () => {
      const { startDate, endDate } = getRollingDayWindow()
      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('startDate is yesterday or today relative to endDate (UK local)', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'))
      const { startDate, endDate } = getRollingDayWindow()
      expect(startDate <= endDate).toBe(true)
      vi.useRealTimers()
    })

    it('endDate equals startDate when the 24h window spans the same UK day', () => {
      vi.useFakeTimers()
      // Noon UTC in summer is 1pm UK BST — 24h earlier is also 1pm the previous day
      vi.setSystemTime(new Date('2024-07-01T12:00:00.000Z'))
      const { startDate, endDate } = getRollingDayWindow()
      expect(typeof startDate).toBe('string')
      expect(typeof endDate).toBe('string')
      vi.useRealTimers()
    })
  })

  describe('applyOffsetToTimestamp', () => {
    it('adds the offset hours to the time for a +01:00 timestamp', () => {
      expect(applyOffsetToTimestamp('2026-08-03T09:00:00+01:00')).toBe(
        '2026-08-03T10:00:00Z'
      )
    })

    it('adds hours and minutes for a +05:30 offset', () => {
      expect(applyOffsetToTimestamp('2026-08-03T09:00:00+05:30')).toBe(
        '2026-08-03T14:30:00Z'
      )
    })

    it('subtracts hours for a negative offset', () => {
      expect(applyOffsetToTimestamp('2026-08-03T09:00:00-05:00')).toBe(
        '2026-08-03T04:00:00Z'
      )
    })

    it('returns the timestamp unchanged when offset is +00:00', () => {
      expect(applyOffsetToTimestamp('2026-08-03T09:00:00+00:00')).toBe(
        '2026-08-03T09:00:00+00:00'
      )
    })

    it('returns the timestamp unchanged when it has a Z suffix', () => {
      expect(applyOffsetToTimestamp('2026-08-03T09:00:00Z')).toBe(
        '2026-08-03T09:00:00Z'
      )
    })

    it('returns the timestamp unchanged when it has no offset', () => {
      expect(applyOffsetToTimestamp('2026-08-03T09:00:00')).toBe(
        '2026-08-03T09:00:00'
      )
    })

    it('handles midnight rollover correctly', () => {
      expect(applyOffsetToTimestamp('2026-08-03T23:00:00+02:00')).toBe(
        '2026-08-04T01:00:00Z'
      )
    })

    it('returns null unchanged', () => {
      expect(applyOffsetToTimestamp(null)).toBeNull()
    })

    it('returns undefined unchanged', () => {
      expect(applyOffsetToTimestamp(undefined)).toBeUndefined()
    })
  })
})
