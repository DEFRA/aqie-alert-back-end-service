import { schedule } from 'node-cron'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { withLock } from '../common/helpers/mongo-lock.js'

/**
 * Builds a Hapi plugin that runs an alert-processing function on a cron
 * schedule. Shared by the pollutant and DAQI schedulers, which have identical
 * shape but differ in their plugin name, log label, lock resource, cron config
 * key, and the actual processor function.
 *
 * Behaviour:
 *  - Runs `processFn(server.db)` immediately on `server.start` so a restart
 *    between cron ticks doesn't miss alerts (the processor's own dedup
 *    handles repeat invocations).
 *  - Schedules subsequent runs via `node-cron` using `cronConfigKey`.
 *  - Each run is wrapped in `withLock(server.locker, lockResource, ...)` so
 *    concurrent instances don't double-fire.
 *  - Stops the cron job cleanly on `onPostStop`.
 *
 * @param {object} opts
 * @param {string} opts.name           plugin name (e.g. 'daqi-alert-scheduler')
 * @param {string} opts.logLabel       human-readable label for log lines (e.g. 'DAQI alert')
 * @param {string} opts.lockResource   mongo-lock resource id (e.g. 'daqi-alert-processing')
 * @param {string} opts.cronConfigKey  config key for the cron expression (e.g. 'ricardoApi.daqiCronSchedule')
 * @param {(db: any) => Promise<void>} opts.processFn the cycle function to invoke
 * @returns Hapi plugin object
 */
export function createAlertSchedulerPlugin({
  name,
  logLabel,
  lockResource,
  cronConfigKey,
  processFn
}) {
  let cronJob

  return {
    plugin: {
      name,
      version: '1.0.0',
      register: async function (server) {
        const logger = createLogger()

        try {
          logger.info(`Starting ${logLabel} scheduler`)

          server.events.on('start', async () => {
            // Run immediately on startup so alerts are not missed if the
            // service restarts between cron ticks. The processor's own
            // dedup state skips alerts already in-progress or processed.
            logger.info(
              `${logLabel} scheduler: running initial cycle on startup`
            )
            try {
              await withLock(server.locker, lockResource, logger, () =>
                processFn(server.db)
              )
            } catch (err) {
              logger.error(`${logLabel} startup run error: ${err.message}`)
            }

            cronJob = schedule(config.get(cronConfigKey), async () => {
              logger.info(`${logLabel} cron job triggered`)
              try {
                await withLock(server.locker, lockResource, logger, () =>
                  processFn(server.db)
                )
              } catch (err) {
                logger.error(`${logLabel} cron job error: ${err.message}`)
                throw err instanceof Error ? err : new Error(String(err))
              }
            })
          })

          server.ext('onPostStop', () => {
            if (cronJob) {
              logger.info(`Stopping ${logLabel} scheduler`)
              cronJob.stop()
            }
          })
        } catch (err) {
          logger.error(`${logLabel} scheduler failed to start: ${err.message}`)
          throw err instanceof Error ? err : new Error(String(err))
        }
      }
    }
  }
}
