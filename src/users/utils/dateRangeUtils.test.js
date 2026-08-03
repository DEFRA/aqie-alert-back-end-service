import { describe, it, expect } from 'vitest'
import { applyOffsetToTimestamp } from './dateRangeUtils.js'

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
