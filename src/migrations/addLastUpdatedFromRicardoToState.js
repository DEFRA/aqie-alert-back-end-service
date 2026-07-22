/**
 * Phase 1 hotfix migration — adds `lastUpdatedFromRicardo` to every document
 * in `pollutant-alert-processing-state` that doesn't already have it.
 *
 * Background
 * ----------
 * The live collection was created before `lastUpdatedFromRicardo` was
 * introduced. The Phase 2 core-logic fix (sliding 24h dedup window) relies on
 * this field being present on ALL state documents. Without it, the classifier
 * would treat every existing processed alert as a `new` event and re-notify
 * users — unacceptable for a live service.
 *
 * What this migration does
 * ------------------------
 * For each document that:
 *   - is missing `lastUpdatedFromRicardo`          (field not yet set), AND
 *   - has a `processedAt` timestamp                (was already fully processed)
 *
 * it sets `lastUpdatedFromRicardo = processedAt`.
 *
 * This is the best available approximation: `processedAt` is the moment WE
 * last confirmed the alert, which is semantically equivalent to "the last time
 * Ricardo confirmed this reading to us" for all pre-migration documents.
 *
 * Docs that have neither field (e.g. stuck `in-progress`) are left alone —
 * the Phase 2 classifier handles them via the `skip-stuck` path.
 *
 * Safety guarantees
 * -----------------
 * - ADDITIVE ONLY: no existing fields are modified or removed.
 * - IDEMPOTENT: the `$exists: false` filter means re-running on every server
 *   restart is harmless — already-migrated docs are skipped.
 * - ZERO DOWNTIME: the old application code never reads `lastUpdatedFromRicardo`,
 *   so deploying this before Phase 2 is safe.
 */

import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()
const COLLECTION = 'pollutant-alert-processing-state'
const MIGRATION_NAME = 'addLastUpdatedFromRicardoToState'

export async function addLastUpdatedFromRicardoToState(db) {
  logger.info(
    `[Migration] ${MIGRATION_NAME}: checking for documents to migrate`
  )

  try {
    // Count how many docs need migrating before we run, so the log is
    // informative on the first deployment and silent on subsequent restarts.
    const pendingCount = await db.collection(COLLECTION).countDocuments({
      lastUpdatedFromRicardo: { $exists: false },
      processedAt: { $exists: true }
    })

    if (pendingCount === 0) {
      logger.info(
        `[Migration] ${MIGRATION_NAME}: nothing to migrate — all documents already have lastUpdatedFromRicardo`
      )
      return
    }

    logger.info(
      `[Migration] ${MIGRATION_NAME}: migrating ${pendingCount} document(s) - copying processedAt into lastUpdatedFromRicardo`
    )

    // Aggregation pipeline update: $set can reference existing fields.
    // This is a single atomic bulk write — MongoDB applies it per-document but
    // the filter guarantees only qualifying docs are touched.
    const result = await db.collection(COLLECTION).updateMany(
      {
        lastUpdatedFromRicardo: { $exists: false },
        processedAt: { $exists: true }
      },
      [
        {
          $set: { lastUpdatedFromRicardo: '$processedAt' }
        }
      ]
    )

    logger.info(
      `[Migration] ${MIGRATION_NAME}: completed — ${result.modifiedCount} document(s) updated`
    )
  } catch (err) {
    // Log and rethrow so server startup fails loudly if the migration cannot
    // run. A silent failure here would leave docs without the field and cause
    // the Phase 2 classifier to silently re-notify users after deployment.
    logger.error(`[Migration] ${MIGRATION_NAME}: failed — ${err.message}`)
    throw err
  }
}
