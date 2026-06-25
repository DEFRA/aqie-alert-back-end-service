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

/**
 * Notifies each matched user for a single alert: inserts the audit entry,
 * sends the notification, updates the audit row with the notificationId.
 *
 * Returns true when every user-location pair succeeded; false if any send
 * failed. Callers use the return value to decide whether the alert is fully
 * processed (and so eligible to be marked 'processed' in the dedup
 * collection) or should be retried on the next cycle.
 *
 * Per-user failures are logged at `error` and don't abort the loop, so a
 * single bad recipient (e.g. an invalid phone number) doesn't block alerts
 * to the other users.
 *
 * @param {object} opts
 * @param {object} opts.db                  Mongo db handle
 * @param {object} opts.alertDetail         resolved alert (with region)
 * @param {Array}  opts.matchedUsers        from getMatchingUsers()
 * @param {string} opts.logPrefix           e.g. '[DAQI]' / '[Pollutant]'
 * @param {Function} opts.insertAuditEntry  (db, alertDetail, userMatch) -> Promise
 * @param {Function} opts.updateAuditEntry  (db, alertId, userContact, location, notificationId) -> Promise
 * @param {Function} opts.sendAlert         (userMatch, alertDetail) -> Promise<notificationId>
 * @returns {Promise<boolean>} true if all notifications were dispatched successfully
 */
export async function sendNotificationsToUsers({
  db,
  alertDetail,
  matchedUsers,
  logPrefix,
  insertAuditEntry,
  updateAuditEntry,
  sendAlert
}) {
  let allSent = true
  for (const userMatch of matchedUsers) {
    await insertAuditEntry(db, alertDetail, userMatch)
    try {
      const notificationId = await sendAlert(userMatch, alertDetail)
      await updateAuditEntry(
        db,
        alertDetail['alert-id'],
        userMatch.userContact,
        userMatch.location,
        notificationId
      )
      logger.info(
        `${logPrefix} Notification sent for alert ${alertDetail['alert-id']} to ${userMatch.alertType} user, notificationId: ${notificationId}`
      )
    } catch (err) {
      allSent = false
      logger.error(
        `${logPrefix} Failed to send notification for alert ${alertDetail['alert-id']} ${JSON.stringify({ alertType: userMatch.alertType, error: err.message })}`
      )
    }
  }
  return allSent
}
