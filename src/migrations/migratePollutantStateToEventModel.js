/**
 * Phase 2 migration — prepares `pollutant-alert-processing-state` for the
 * event-model (DAQI-parity) core logic.
 *
 * Background
 * ----------
 * Phase 2 replaces the old "permanent block per samplingPointId" dedup with a
 * 24h sliding-window model where each distinct breach event gets its own state
 * document. The dedup key becomes the compound `{ alert-id, alert-started-timestamp }`
 * (alert-id already holds the samplingPointId value), and a beyond-24h gap
 * produces a NEW document (new alert-started-timestamp) instead of overwriting.
 *
 * Legacy documents were written under the old model: they have `alert-id`
 * (the samplingPointId) and (after `addLastUpdatedFromRicardoToState`)
 * `lastUpdatedFromRicardo`, but they have NO `alert-started-timestamp`, and the
 * collection still carries a single-column unique index on `alert-id`.
 *
 * What this migration does
 * ------------------------
 *   1. Backfills `alert-started-timestamp` on every legacy doc that lacks it,
 *      derived from `processedAt` (→ `createdAt` → `lastUpdatedFromRicardo`).
 *      Stored as an ISO STRING (via $toString) so it sorts chronologically
 *      against the Ricardo date strings that Phase 2 rows write — the classifier
 *      sorts state rows by this field descending to pick the latest event.
 *   2. Drops the stale single-column unique index on `alert-id`. The compound
 *      `{ alert-id, alert-started-timestamp }` unique index (built by
 *      createIndexes) replaces it. Left in place, it would reject the second
 *      breach event for a samplingPointId (same alert-id, new timestamp).
 *
 * Safety guarantees
 * -----------------
 * - ADDITIVE to data: only sets a missing field; never modifies existing values.
 * - IDEMPOTENT: the `$exists: false` filter and the IndexNotFound-tolerant drop
 *   make re-running on every server restart harmless.
 * - ORDERING: runs in `onPreStart`, AFTER createIndexes has built the compound
 *   index (safe — legacy alert-ids are unique, so `(alert-id, null)` keys don't
 *   collide) and BEFORE the schedulers start.
 */

import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()
const COLLECTION = 'pollutant-alert-processing-state'
const OLD_UNIQUE_INDEX = 'alert-id_1'
const MIGRATION_NAME = 'migratePollutantStateToEventModel'
const INDEX_NOT_FOUND_CODE = 27

export async function migratePollutantStateToEventModel(db) {
  logger.info(
    `[Migration] ${MIGRATION_NAME}: checking for documents to migrate`
  )

  try {
    const col = db.collection(COLLECTION)

    // --- Step 1: backfill alert-started-timestamp on legacy docs -----------
    const pending = await col.countDocuments({
      'alert-started-timestamp': { $exists: false }
    })

    if (pending > 0) {
      logger.info(
        `[Migration] ${MIGRATION_NAME}: backfilling alert-started-timestamp on ${pending} legacy doc(s)`
      )
      await col.updateMany({ 'alert-started-timestamp': { $exists: false } }, [
        {
          $set: {
            'alert-started-timestamp': {
              $toString: {
                $ifNull: [
                  '$processedAt',
                  '$createdAt',
                  '$lastUpdatedFromRicardo'
                ]
              }
            }
          }
        }
      ])
    } else {
      logger.info(
        `[Migration] ${MIGRATION_NAME}: no legacy docs need alert-started-timestamp`
      )
    }

    // --- Step 2: drop the stale single-column unique index -----------------
    try {
      await col.dropIndex(OLD_UNIQUE_INDEX)
      logger.info(
        `[Migration] ${MIGRATION_NAME}: dropped stale unique index ${OLD_UNIQUE_INDEX}`
      )
    } catch (err) {
      if (
        err.codeName !== 'IndexNotFound' &&
        err.code !== INDEX_NOT_FOUND_CODE
      ) {
        throw err
      }
      logger.info(
        `[Migration] ${MIGRATION_NAME}: index ${OLD_UNIQUE_INDEX} already absent — nothing to drop`
      )
    }

    logger.info(`[Migration] ${MIGRATION_NAME}: completed`)
  } catch (err) {
    // Fail loudly on startup — a silent failure would leave docs without
    // alert-started-timestamp and cause the classifier to mis-sort event rows.
    logger.error(`[Migration] ${MIGRATION_NAME}: failed — ${err.message}`)
    throw err
  }
}
