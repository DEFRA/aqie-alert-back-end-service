import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()
const COLLECTION = 'pollutant-alert-processing-state'
const MIGRATION_NAME = 'addAlertStartedTimestampToState'

export async function addAlertStartedTimestampToState(db) {
  logger.info(
    `[Migration] ${MIGRATION_NAME}: checking for documents to migrate`
  )

  try {
    // Count how many docs need migrating before we run, so the log is
    // informative on the first deployment and silent on subsequent restarts.
    const pendingCount = await db.collection(COLLECTION).countDocuments({
      'alert-started-timestamp': { $exists: false },
      createdAt: { $exists: true }
    })

    if (pendingCount === 0) {
      logger.info(
        `[Migration] ${MIGRATION_NAME}: nothing to migrate — all documents already have alertStartedTimestamp`
      )
      return
    }

    logger.info(
      `[Migration] ${MIGRATION_NAME}: migrating ${pendingCount} document(s) - copying processedAt into alertStartedTimestamp`
    )

    // Aggregation pipeline update: $set can reference existing fields.
    // This is a single atomic bulk write — MongoDB applies it per-document but
    // the filter guarantees only qualifying docs are touched.
    const result = await db.collection(COLLECTION).updateMany(
      {
        'alert-started-timestamp': { $exists: false },
        createdAt: { $exists: true }
      },
      [
        {
          $set: { 'alert-started-timestamp': '$createdAt' }
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
