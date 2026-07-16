/**
 * Deduplicates alerts by samplingPointId using the following rules:
 *   - different timestamp → keep the alert with the latest timestamp
 *   - same timestamp     → keep the alert with the highest tie-breaker value
 *
 * Used by: DAQI Alert API, AQSR Alert API (Mode 1)
 *
 * @param {object[]} alerts        - Array of alert objects to deduplicate.
 * @param {string}   tieBreakerKey - Alert field to compare when timestamps are equal (e.g. 'daqi', 'concentration').
 * @returns {object[]} Deduplicated array, one entry per samplingPointId.
 */
export function deduplicateAlerts(alerts, tieBreakerKey) {
  const best = new Map()
  for (const alert of alerts) {
    const key = alert.samplingPointId
    const existing = best.get(key)
    if (!existing) {
      best.set(key, alert)
      continue
    }
    const incomingTime = new Date(alert.date).getTime()
    const existingTime = new Date(existing.date).getTime()
    if (
      incomingTime > existingTime ||
      (incomingTime === existingTime &&
        alert[tieBreakerKey] > existing[tieBreakerKey])
    ) {
      best.set(key, alert)
    }
  }
  return [...best.values()]
}

/**
 * Deduplicates alerts by samplingPointId using the following rules:
 *   - different timestamp → keep the alert with the OLDEST timestamp
 *   - same timestamp     → keep the alert with the highest tie-breaker value
 *
 * Used by: DAQI cron job — the cron job needs to notify based on when the
 * breach first started (oldest reading), not the latest refresh from Ricardo.
 * Highest tie-breaker (daqi) is still used when timestamps are equal so the
 * most severe reading wins in a tie.
 *
 * @param {object[]} alerts        - Array of alert objects to deduplicate.
 * @param {string}   tieBreakerKey - Alert field to compare when timestamps are equal (e.g. 'daqi').
 * @returns {object[]} Deduplicated array, one entry per samplingPointId.
 */
export function deduplicateAlertsOldestFirst(alerts, tieBreakerKey) {
  const best = new Map()
  for (const alert of alerts) {
    const key = alert.samplingPointId
    const existing = best.get(key)
    if (!existing) {
      best.set(key, alert)
      continue
    }
    const incomingTime = new Date(alert.date).getTime()
    const existingTime = new Date(existing.date).getTime()
    if (
      incomingTime < existingTime ||
      (incomingTime === existingTime &&
        alert[tieBreakerKey] > existing[tieBreakerKey])
    ) {
      best.set(key, alert)
    }
  }
  return [...best.values()]
}
