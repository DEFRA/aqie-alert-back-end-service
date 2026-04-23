import { schedule } from 'node-cron'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { processPollutantAlerts } from '../users/utils/pollutantAlertProcessor.js'
import { withLock } from '../common/helpers/mongo-lock.js'

let cronJob

const pollutantAlertScheduler = {
  plugin: {
    name: 'pollutant-alert-scheduler',
    version: '1.0.0',
    register: async function (server) {
      const logger = createLogger()

      try {
        logger.info('Starting pollutant alert scheduler')

        server.events.on('start', async () => {
          // Run immediately on startup so alerts are not missed if the service
          // restarts between cron ticks. processPollutantAlerts skips alerts
          // that are already in-progress or processed via pollutant-alert-processing-state check.
          logger.info(
            'Pollutant alert scheduler: running initial cycle on startup'
          )
          try {
            await withLock(
              server.locker,
              'pollutant-alert-processing',
              logger,
              () => processPollutantAlerts(server.db)
            )
          } catch (err) {
            logger.error(`Pollutant alert startup run error: ${err.message}`)
          }

          cronJob = schedule(
            config.get('ricardoApi.cronSchedule'),
            async () => {
              logger.info('Pollutant alert cron job triggered')
              try {
                await withLock(
                  server.locker,
                  'pollutant-alert-processing',
                  logger,
                  () => processPollutantAlerts(server.db)
                )
              } catch (err) {
                logger.error(`Pollutant alert cron job error: ${err.message}`)
                throw err instanceof Error ? err : new Error(String(err))
              }
            }
          )
        })

        server.ext('onPostStop', () => {
          if (cronJob) {
            logger.info('Stopping pollutant alert scheduler')
            cronJob.stop()
          }
        })
      } catch (err) {
        logger.error(
          `Pollutant alert scheduler failed to start: ${err.message}`
        )
        throw err instanceof Error ? err : new Error(String(err))
      }
    }
  }
}

export { pollutantAlertScheduler }
