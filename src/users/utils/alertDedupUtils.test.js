import { describe, it, expect } from 'vitest'
import {
  deduplicateAlerts,
  deduplicateAlertsOldestFirst
} from './alertDedupUtils.js'

function makeAlert(overrides = {}) {
  return {
    samplingPointId: 1001,
    date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    daqi: 5,
    concentration: 10,
    ...overrides
  }
}

describe('deduplicateAlerts', () => {
  describe('empty / single input', () => {
    it('should return an empty array when given an empty array', () => {
      expect(deduplicateAlerts([], 'daqi')).toEqual([])
    })

    it('should return the single alert unchanged when only one alert is provided', () => {
      const alert = makeAlert()
      expect(deduplicateAlerts([alert], 'daqi')).toEqual([alert])
    })
  })

  describe('alerts with different samplingPointIds', () => {
    it('should keep all alerts when each has a unique samplingPointId', () => {
      const a1 = makeAlert({ samplingPointId: 1001 })
      const a2 = makeAlert({ samplingPointId: 1002 })
      const a3 = makeAlert({ samplingPointId: 1003 })
      const result = deduplicateAlerts([a1, a2, a3], 'daqi')
      expect(result).toHaveLength(3)
    })
  })

  describe('same samplingPointId — different timestamps', () => {
    it('should keep the alert with the latest timestamp (newer wins regardless of tie-breaker value)', () => {
      const older = makeAlert({
        samplingPointId: 1001,
        date: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), // 10h ago
        daqi: 10
      })
      const newer = makeAlert({
        samplingPointId: 1001,
        date: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1h ago
        daqi: 5
      })
      const result = deduplicateAlerts([older, newer], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(5)
      expect(result[0].date).toBe(newer.date)
    })

    it('should keep the alert with the latest timestamp when newer has higher tie-breaker value too', () => {
      const older = makeAlert({
        samplingPointId: 1001,
        date: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        daqi: 7
      })
      const newer = makeAlert({
        samplingPointId: 1001,
        date: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        daqi: 10
      })
      const result = deduplicateAlerts([older, newer], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(10)
    })

    it('should handle 3+ alerts for the same samplingPointId and keep only the latest', () => {
      const t1 = makeAlert({
        samplingPointId: 1001,
        date: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
        daqi: 9
      })
      const t2 = makeAlert({
        samplingPointId: 1001,
        date: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
        daqi: 6
      })
      const t3 = makeAlert({
        samplingPointId: 1001,
        date: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        daqi: 4
      })
      const result = deduplicateAlerts([t1, t2, t3], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(4)
      expect(result[0].date).toBe(t3.date)
    })
  })

  describe('same samplingPointId — same timestamp (tie-breaker)', () => {
    it('should keep the alert with the higher tie-breaker value when timestamps are equal', () => {
      const sameDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      const low = makeAlert({ samplingPointId: 1001, date: sameDate, daqi: 7 })
      const high = makeAlert({
        samplingPointId: 1001,
        date: sameDate,
        daqi: 10
      })
      const result = deduplicateAlerts([low, high], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(10)
    })

    it('should keep existing when incoming tie-breaker value is equal (no replacement)', () => {
      const sameDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      const first = makeAlert({
        samplingPointId: 1001,
        date: sameDate,
        daqi: 8
      })
      const second = makeAlert({
        samplingPointId: 1001,
        date: sameDate,
        daqi: 8
      })
      const result = deduplicateAlerts([first, second], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0]).toBe(first) // first inserted is kept
    })

    it('should keep existing when incoming tie-breaker value is lower', () => {
      const sameDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      const high = makeAlert({
        samplingPointId: 1001,
        date: sameDate,
        daqi: 10
      })
      const low = makeAlert({ samplingPointId: 1001, date: sameDate, daqi: 5 })
      const result = deduplicateAlerts([high, low], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(10)
    })
  })

  describe('concentration as tie-breaker (AQSR usage)', () => {
    it('should use concentration as tie-breaker when tieBreakerKey is "concentration"', () => {
      const sameDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      const low = makeAlert({
        samplingPointId: 2001,
        date: sameDate,
        concentration: 15
      })
      const high = makeAlert({
        samplingPointId: 2001,
        date: sameDate,
        concentration: 40
      })
      const result = deduplicateAlerts([low, high], 'concentration')
      expect(result).toHaveLength(1)
      expect(result[0].concentration).toBe(40)
    })

    it('should prefer latest timestamp over higher concentration (AQSR — same as DAQI)', () => {
      const older = makeAlert({
        samplingPointId: 2001,
        date: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
        concentration: 80
      })
      const newer = makeAlert({
        samplingPointId: 2001,
        date: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        concentration: 20
      })
      const result = deduplicateAlerts([older, newer], 'concentration')
      expect(result).toHaveLength(1)
      expect(result[0].concentration).toBe(20)
    })
  })

  describe('mixed samplingPointIds', () => {
    it('should correctly dedup across multiple samplingPointIds independently', () => {
      const sameDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const newerDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()

      const alerts = [
        makeAlert({ samplingPointId: 1001, date: sameDate, daqi: 7 }),
        makeAlert({ samplingPointId: 1001, date: sameDate, daqi: 10 }), // same time, higher daqi → wins for 1001
        makeAlert({ samplingPointId: 1002, date: sameDate, daqi: 9 }),
        makeAlert({ samplingPointId: 1002, date: newerDate, daqi: 3 }), // newer time → wins for 1002
        makeAlert({ samplingPointId: 1003, date: sameDate, daqi: 6 }) // only one → wins for 1003
      ]

      const result = deduplicateAlerts(alerts, 'daqi')
      expect(result).toHaveLength(3)

      const byId = Object.fromEntries(result.map((a) => [a.samplingPointId, a]))
      expect(byId[1001].daqi).toBe(10)
      expect(byId[1002].daqi).toBe(3)
      expect(byId[1002].date).toBe(newerDate)
      expect(byId[1003].daqi).toBe(6)
    })
  })
})

// ---------------------------------------------------------------------------
// deduplicateAlertsOldestFirst — DAQI cron job logic
// Rule: oldest timestamp wins; highest daqi as tie-breaker on equal timestamps
// ---------------------------------------------------------------------------
describe('deduplicateAlertsOldestFirst', () => {
  describe('empty / single input', () => {
    it('should return an empty array when given an empty array', () => {
      expect(deduplicateAlertsOldestFirst([], 'daqi')).toEqual([])
    })

    it('should return the single alert unchanged when only one alert is provided', () => {
      const alert = makeAlert()
      expect(deduplicateAlertsOldestFirst([alert], 'daqi')).toEqual([alert])
    })
  })

  describe('alerts with different samplingPointIds', () => {
    it('should keep all alerts when each has a unique samplingPointId', () => {
      const a1 = makeAlert({ samplingPointId: 1001 })
      const a2 = makeAlert({ samplingPointId: 1002 })
      const a3 = makeAlert({ samplingPointId: 1003 })
      const result = deduplicateAlertsOldestFirst([a1, a2, a3], 'daqi')
      expect(result).toHaveLength(3)
    })
  })

  describe('same samplingPointId — different timestamps', () => {
    it('scenario 2: daqi 7 @ 6am vs daqi 10 @ 10am → keeps oldest (daqi 7 @ 6am)', () => {
      const sixAm = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString()
      const tenAm = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
      const older = makeAlert({ samplingPointId: 1001, date: sixAm, daqi: 7 })
      const newer = makeAlert({ samplingPointId: 1001, date: tenAm, daqi: 10 })
      const result = deduplicateAlertsOldestFirst([older, newer], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(7)
      expect(result[0].date).toBe(sixAm)
    })

    it('scenario 3: daqi 10 @ 6am vs daqi 7 @ 10am → keeps oldest (daqi 10 @ 6am)', () => {
      const sixAm = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString()
      const tenAm = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
      const older = makeAlert({ samplingPointId: 1001, date: sixAm, daqi: 10 })
      const newer = makeAlert({ samplingPointId: 1001, date: tenAm, daqi: 7 })
      const result = deduplicateAlertsOldestFirst([older, newer], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(10)
      expect(result[0].date).toBe(sixAm)
    })

    it('should keep the oldest among 3 alerts with different timestamps', () => {
      const t1 = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString() // oldest
      const t2 = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString()
      const t3 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() // newest
      const alerts = [
        makeAlert({ samplingPointId: 1001, date: t2, daqi: 8 }),
        makeAlert({ samplingPointId: 1001, date: t3, daqi: 9 }),
        makeAlert({ samplingPointId: 1001, date: t1, daqi: 7 })
      ]
      const result = deduplicateAlertsOldestFirst(alerts, 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].date).toBe(t1)
      expect(result[0].daqi).toBe(7)
    })
  })

  describe('same samplingPointId — same timestamp (tie-breaker: highest daqi)', () => {
    it('scenario 1: daqi 7 vs 10 same timestamp → keeps highest daqi (10)', () => {
      const sameDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const low = makeAlert({ samplingPointId: 1001, date: sameDate, daqi: 7 })
      const high = makeAlert({
        samplingPointId: 1001,
        date: sameDate,
        daqi: 10
      })
      const result = deduplicateAlertsOldestFirst([low, high], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(10)
    })

    it('3 alerts same timestamp daqi 7, 10, 8 → keeps daqi 10', () => {
      const sameDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const alerts = [
        makeAlert({ samplingPointId: 1001, date: sameDate, daqi: 7 }),
        makeAlert({ samplingPointId: 1001, date: sameDate, daqi: 10 }),
        makeAlert({ samplingPointId: 1001, date: sameDate, daqi: 8 })
      ]
      const result = deduplicateAlertsOldestFirst(alerts, 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(10)
    })

    it('should keep existing when incoming daqi is lower on same timestamp', () => {
      const sameDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const high = makeAlert({
        samplingPointId: 1001,
        date: sameDate,
        daqi: 10
      })
      const low = makeAlert({ samplingPointId: 1001, date: sameDate, daqi: 5 })
      const result = deduplicateAlertsOldestFirst([high, low], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0].daqi).toBe(10)
    })

    it('should keep existing when incoming daqi is equal on same timestamp', () => {
      const sameDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const first = makeAlert({
        samplingPointId: 1001,
        date: sameDate,
        daqi: 8
      })
      const second = makeAlert({
        samplingPointId: 1001,
        date: sameDate,
        daqi: 8
      })
      const result = deduplicateAlertsOldestFirst([first, second], 'daqi')
      expect(result).toHaveLength(1)
      expect(result[0]).toBe(first)
    })
  })

  describe('mixed samplingPointIds', () => {
    it('should dedup each samplingPointId independently using oldest-first rule', () => {
      const t1 = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString() // oldest
      const t2 = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
      const t3 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() // newest

      const alerts = [
        makeAlert({ samplingPointId: 1001, date: t1, daqi: 7 }), // oldest → wins for 1001
        makeAlert({ samplingPointId: 1001, date: t2, daqi: 10 }),
        makeAlert({ samplingPointId: 1002, date: t2, daqi: 9 }), // oldest → wins for 1002
        makeAlert({ samplingPointId: 1002, date: t3, daqi: 3 }),
        makeAlert({ samplingPointId: 1003, date: t3, daqi: 6 }) // only one → wins for 1003
      ]

      const result = deduplicateAlertsOldestFirst(alerts, 'daqi')
      expect(result).toHaveLength(3)

      const byId = Object.fromEntries(result.map((a) => [a.samplingPointId, a]))
      expect(byId[1001].date).toBe(t1)
      expect(byId[1001].daqi).toBe(7)
      expect(byId[1002].date).toBe(t2)
      expect(byId[1002].daqi).toBe(9)
      expect(byId[1003].daqi).toBe(6)
    })
  })
})
