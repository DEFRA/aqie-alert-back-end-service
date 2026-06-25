import { schedule } from 'node-cron'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { processDaqiAlerts } from '../users/utils/daqiAlertProcessor.js'
import { withLock } from '../common/helpers/mongo-lock.js'

let cronJob

const daqiAlertScheduler = {
  plugin: {
    name: 'daqi-alert-scheduler',
    version: '1.0.0',
    register: async function (server) {
      const logger = createLogger()

      try {
        logger.info('Starting DAQI alert scheduler')

        server.events.on('start', async () => {
          // Run immediately on startup so alerts are not missed if the service
          // restarts between cron ticks. processDaqiAlerts skips alerts
          // that are already in-progress or processed via the
          // daqi-alert-processing-state check.
          logger.info('DAQI alert scheduler: running initial cycle on startup')
          try {
            await withLock(server.locker, 'daqi-alert-processing', logger, () =>
              processDaqiAlerts(server.db)
            )
          } catch (err) {
            logger.error(`DAQI alert startup run error: ${err.message}`)
          }

          cronJob = schedule(
            config.get('ricardoApi.daqiCronSchedule'),
            async () => {
              logger.info('DAQI alert cron job triggered')
              try {
                await withLock(
                  server.locker,
                  'daqi-alert-processing',
                  logger,
                  () => processDaqiAlerts(server.db)
                )
              } catch (err) {
                logger.error(`DAQI alert cron job error: ${err.message}`)
                throw err instanceof Error ? err : new Error(String(err))
              }
            }
          )
        })

        server.ext('onPostStop', () => {
          if (cronJob) {
            logger.info('Stopping DAQI alert scheduler')
            cronJob.stop()
          }
        })
      } catch (err) {
        logger.error(`DAQI alert scheduler failed to start: ${err.message}`)
        throw err instanceof Error ? err : new Error(String(err))
      }
    }
  }
}

export { daqiAlertScheduler }
