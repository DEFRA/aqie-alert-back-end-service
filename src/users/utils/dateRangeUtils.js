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

export { UK_DATE_FORMATTER, TWENTY_FOUR_HOURS_MS }
