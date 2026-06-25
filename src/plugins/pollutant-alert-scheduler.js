import { processPollutantAlerts } from '../users/utils/pollutantAlertProcessor.js'
import { createAlertSchedulerPlugin } from './createAlertSchedulerPlugin.js'

const pollutantAlertScheduler = createAlertSchedulerPlugin({
  name: 'pollutant-alert-scheduler',
  logLabel: 'Pollutant alert',
  lockResource: 'pollutant-alert-processing',
  cronConfigKey: 'ricardoApi.cronSchedule',
  processFn: processPollutantAlerts
})

export { pollutantAlertScheduler }
