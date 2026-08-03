const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

// en-CA locale formats as YYYY-MM-DD; timeZone pins it to UK local date
// regardless of host timezone, so BST/GMT shifts are handled correctly.
const UK_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/**
 * Returns true when `dateString` is within the last 24 hours of `Date.now()`.
 * Invalid date strings return false. Future dates also return false.
 */
export function isWithinLast24Hours(dateString) {
  const alertDate = new Date(dateString)
  if (!Number.isFinite(alertDate.getTime())) {
    return false
  }
  const ageMs = Date.now() - alertDate.getTime()
  return ageMs >= 0 && ageMs <= TWENTY_FOUR_HOURS_MS
}

/**
 * Returns `{ startDate, endDate }` in `YYYY-MM-DD` for the rolling 24-hour
 * window ending now, formatted as UK local dates. Used to narrow Ricardo
 * date-range queries (downstream filtering with `isWithinLast24Hours` trims to
 * the precise millisecond window).
 */
export function getRollingDayWindow() {
  const now = new Date()
  return {
    startDate: UK_DATE_FORMATTER.format(
      new Date(now.getTime() - TWENTY_FOUR_HOURS_MS)
    ),
    endDate: UK_DATE_FORMATTER.format(now)
  }
}

/**
 * Adjusts an ISO timestamp by its own UTC offset so the returned time
 * reflects the local clock time at that offset.
 *
 * Ricardo returns timestamps like "2026-08-03T09:00:00+01:00". The "+01:00"
 * means the reading was recorded at 09:00 in a UTC+1 zone. Adding the offset
 * (1 hour) to the time gives 10:00 — the correct local display time.
 *
 * Timestamps with no offset (Z or bare datetime) are returned unchanged.
 * Timestamps with +00:00 are returned unchanged (no adjustment needed).
 */
export function applyOffsetToTimestamp(isoString) {
  if (!isoString) {
    return isoString
  }

  const match = isoString.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-])(\d{2}):(\d{2})$/
  )
  if (!match) {
    return isoString
  }

  const [, datetimePart, sign, offsetHH, offsetMM] = match
  const offsetMinutes =
    (parseInt(offsetHH, 10) * 60 + parseInt(offsetMM, 10)) *
    (sign === '+' ? 1 : -1)

  if (offsetMinutes === 0) {
    return isoString
  }

  const adjusted = new Date(datetimePart + 'Z')
  adjusted.setUTCMinutes(adjusted.getUTCMinutes() + offsetMinutes)

  return adjusted.toISOString().replace('.000Z', 'Z')
}

export { UK_DATE_FORMATTER, TWENTY_FOUR_HOURS_MS }
