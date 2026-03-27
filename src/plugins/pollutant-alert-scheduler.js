import { config } from '../config.js'
import { processPollutantAlerts } from '../users/utils/pollutantAlertProcessor.js'

const pollutantAlertScheduler = {
  plugin: {
    name: 'pollutant-alert-scheduler',
    version: '1.0.0',
    register: async function (server) {
      const intervalMs = config.get('ricardoApi.pollingIntervalMs')
      let intervalId = null
      let isRunning = false

      async function runCycle() {
        if (isRunning) {
          server.logger.info(
            'Pollutant alert cycle already running, skipping this tick'
          )
          return
        }

        isRunning = true
        try {
          await processPollutantAlerts(server.db)
        } catch (err) {
          server.logger.error(`Pollutant alert scheduler error: ${err.message}`)
        } finally {
          isRunning = false
        }
      }

      server.events.on('start', () => {
        server.logger.info(
          `Pollutant alert scheduler started with interval ${intervalMs}ms`
        )
        runCycle()
        intervalId = setInterval(runCycle, intervalMs)
      })

      server.events.on('stop', () => {
        if (intervalId) {
          clearInterval(intervalId)
          server.logger.info('Pollutant alert scheduler stopped')
        }
      })
    }
  }
}

export { pollutantAlertScheduler }
