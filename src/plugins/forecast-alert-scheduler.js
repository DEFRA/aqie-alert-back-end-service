import { schedule } from 'node-cron'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { processForecastAlerts } from '../users/utils/forecastAlertProcessor.js'
import { withLock } from '../common/helpers/mongo-lock.js'

let cronJob

const forecastAlertScheduler = {
  plugin: {
    name: 'forecast-alert-scheduler',
    version: '1.0.0',
    register: async function (server) {
      const logger = createLogger()

      try {
        logger.info('Starting MetOffice forecast alert scheduler')

        server.events.on('start', async () => {
          // Run immediately on startup to handle restarts that occur within
          // the daily window after a tick has already been missed.
          // processForecastAlerts skips gracefully if already completed today
          // via the forecast-schedule-state check.
          logger.info(
            'Forecast alert scheduler: running initial cycle on startup'
          )
          try {
            await withLock(
              server.locker,
              'forecast-alert-processing',
              logger,
              () => processForecastAlerts(server.db)
            )
          } catch (err) {
            logger.error(`Forecast alert startup run error: ${err.message}`)
          }

          cronJob = schedule(
            config.get('metOfficeForecast.cronSchedule'),
            async () => {
              logger.info('MetOffice forecast alert cron job triggered')
              try {
                await withLock(
                  server.locker,
                  'forecast-alert-processing',
                  logger,
                  () => processForecastAlerts(server.db)
                )
              } catch (err) {
                logger.error(`Forecast alert cron job error: ${err.message}`)
                throw err instanceof Error ? err : new Error(String(err))
              }
            }
          )
        })

        server.ext('onPostStop', () => {
          if (cronJob) {
            logger.info('Stopping MetOffice forecast alert scheduler')
            cronJob.stop()
          }
        })
      } catch (err) {
        logger.error(`Forecast alert scheduler failed to start: ${err.message}`)
        throw err instanceof Error ? err : new Error(String(err))
      }
    }
  }
}

export { forecastAlertScheduler }
