import {
  getSiteCacheSize,
  ensureSiteCachePopulated
} from './ricardoSiteAndRegionCache.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Ricardo can return the same logical breach (same alert-id) multiple times in
 * a single response. Collapse to first occurrence so a single cron cycle
 * doesn't double-process a row. The downstream audit unique index would reject
 * the second insert anyway — this avoids the wasted Notify calls and noisy
 * logs.
 *
 * @param {Array<{ 'alert-id': string }>} alerts
 * @returns {Array} unique alerts in original order
 */
export function collapseInCycleDuplicates(alerts) {
  const seen = new Set()
  const unique = []
  for (const alert of alerts) {
    if (!seen.has(alert['alert-id'])) {
      seen.add(alert['alert-id'])
      unique.push(alert)
    }
  }
  return unique
}

/**
 * Cycle-level guard. Region resolution depends entirely on the site cache. If
 * it's empty the startup fetch likely failed — try one on-demand refresh, and
 * tell the caller to abort the cycle rather than per-alert skipping when even
 * that fails. Returns true when the cache is usable.
 *
 * @param {string} logPrefix - e.g. '[DAQI]' or '[Pollutant]' for log correlation
 * @returns {Promise<boolean>} true if the cache holds at least one site
 */
export async function ensureCacheReadyForCycle(logPrefix) {
  if (getSiteCacheSize() > 0) {
    return true
  }
  const populated = await ensureSiteCachePopulated()
  if (populated) {
    return true
  }
  logger.info(
    `${logPrefix} Site cache empty and refresh failed; skipping cycle (will retry on next run)`
  )
  return false
}

/**
 * Expands a list of user docs into one entry per matching user-location pair
 * for the given region. Each entry carries userContact, alertType, location
 * and lang (defaulting to 'en' if absent on the user doc).
 */
export function getMatchingUsers(users, alertRegion) {
  return users.flatMap((user) =>
    (user.locations ?? [])
      .filter((loc) => loc.region === alertRegion)
      .map((loc) => ({
        userContact: user.user_contact,
        alertType: user.alertType,
        location: loc.location,
        lang: user.lang ?? 'en'
      }))
  )
}
