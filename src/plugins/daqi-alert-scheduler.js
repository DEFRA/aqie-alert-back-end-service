import { processDaqiAlerts } from '../users/utils/daqiAlertProcessor.js'
import { createAlertSchedulerPlugin } from './createAlertSchedulerPlugin.js'

const daqiAlertScheduler = createAlertSchedulerPlugin({
  name: 'daqi-alert-scheduler',
  logLabel: 'DAQI alert',
  lockResource: 'daqi-alert-processing',
  cronConfigKey: 'ricardoApi.daqiCronSchedule',
  processFn: processDaqiAlerts
})

export { daqiAlertScheduler }
