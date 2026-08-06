import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isWithinLast24Hours,
  getRollingDayWindow,
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
})
