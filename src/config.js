import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from './common/helpers/convict/validate-mongo-uri.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind',
    format: 'port',
    default: 3001,
    env: 'PORT'
  },
  serviceName: {
    doc: 'Api Service Name',
    format: String,
    default: 'aqie-alert-back-end-service'
  },
  cdpEnvironment: {
    doc: 'The CDP environment the app is running in. With the addition of "local" for local development',
    format: [
      'local',
      'infra-dev',
      'management',
      'dev',
      'test',
      'perf-test',
      'ext-test',
      'prod'
    ],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  log: {
    isEnabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: !isTest,
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : ['req', 'res', 'responseTime']
    }
  },
  mongo: {
    mongoUrl: {
      doc: 'URI for mongodb',
      format: String,
      default: 'mongodb://127.0.0.1:27017/',
      env: 'MONGO_URI'
    },
    databaseName: {
      doc: 'database for mongodb',
      format: String,
      default: 'aqie-alert-back-end-service',
      env: 'MONGO_DATABASE'
    },
    mongoOptions: {
      retryWrites: {
        doc: 'Enable Mongo write retries, overrides mongo URI when set.',
        format: Boolean,
        default: null,
        nullable: true,
        env: 'MONGO_RETRY_WRITES'
      },
      readPreference: {
        doc: 'Mongo read preference, overrides mongo URI when set.',
        format: [
          'primary',
          'primaryPreferred',
          'secondary',
          'secondaryPreferred',
          'nearest'
        ],
        default: null,
        nullable: true,
        env: 'MONGO_READ_PREFERENCE'
      }
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy URL',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  httpsProxy: {
    doc: 'HTTPS Proxy',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTPS_PROXY'
  },
  notification: {
    serviceUrl: {
      doc: 'Notification service URL',
      format: String,
      default: 'http://localhost:3005/send-notification',
      env: 'NOTIFICATION_SERVICE_URL'
    },
    templates: {
      smsSetUpConfirmation: {
        doc: 'SMS notification template ID',
        format: String,
        default: '897b8018-f822-4fa3-bcd6-936972546c4e',
        env: 'SMS_SET_UP_CONFIRMATION_TEMPLATE_ID'
      },
      emailSetUpConfirmation: {
        doc: 'Email notification template ID',
        format: String,
        default: 'ef68edc3-a936-48d9-ae86-d3bf1d86d29a',
        env: 'EMAIL_SET_UP_CONFIRMATION_TEMPLATE_ID'
      },
      unsubscribeEmailLink: {
        doc: 'Unsubscribe email link (frontend URL)',
        format: String,
        default:
          'https://aqie-front-end.test.cdp-int.defra.cloud/notify/unsubscribe-email-link',
        env: 'UNSUBSCRIBE_EMAIL_LINK'
      }
    }
  },
  ricardoApi: {
    loginUrl: {
      doc: 'Ricardo API login URL for token generation',
      format: String,
      default: 'https://api-ukair.defra.gov.uk/api/login_check',
      env: 'RICARDO_API_LOGIN_URL'
    },
    alertsUrl: {
      doc: 'Ricardo API AQSR alerts endpoint',
      format: String,
      default: 'https://api-ukair.defra.gov.uk/api/aqsr_alerts',
      env: 'RICARDO_API_ALERTS_URL'
    },
    daqiAlertsUrl: {
      doc: 'Ricardo API DAQI alerts endpoint',
      format: String,
      default: 'https://api-ukair.defra.gov.uk/api/daqi_alerts',
      env: 'RICARDO_API_DAQI_ALERTS_URL'
    },
    email: {
      doc: 'Ricardo API login email',
      format: String,
      default: 'maruthi.chokkanathan@cognizant.com',
      env: 'RICARDO_API_EMAIL'
    },
    password: {
      doc: 'Ricardo API login password',
      format: String,
      default: 'Mr5e7TFseqzD8Mt#',
      env: 'RICARDO_API_PASSWORD',
      sensitive: true
    },
    cronSchedule: {
      doc: 'Cron expression for the pollutant alert job (default: every 15 minutes)',
      format: String,
      default: '*/15 * * * *',
      env: 'POLLUTANT_CRON_SCHEDULE'
    },
    daqiCronSchedule: {
      doc: 'Cron expression for the DAQI alert job (default: every 15 minutes)',
      format: String,
      default: '*/15 * * * *',
      env: 'DAQI_ALERT_CRON_SCHEDULE'
    },
    useMock: {
      doc: 'Use mock Ricardo API response instead of making real HTTP calls (for local testing)',
      format: Boolean,
      default: true,
      env: 'RICARDO_API_USE_MOCK'
    },
    daqiMockUrl: {
      doc: 'WireMock stub URL for DAQI alerts (used when RICARDO_API_USE_MOCK=true)',
      format: String,
      default: 'https://ricardomockalerts.wiremockapi.cloud/api/daqi_alerts',
      env: 'RICARDO_API_DAQI_MOCK_URL'
    },
    aqsrMockUrl: {
      doc: 'WireMock stub URL for AQSR alerts (used when RICARDO_API_USE_MOCK=true)',
      format: String,
      default: 'https://aqsrricardomock.wiremockapi.cloud/api/aqsr_alerts',
      env: 'RICARDO_API_AQSR_MOCK_URL'
    },
    siteMetaDataUrl: {
      doc: 'Ricardo API site metadata endpoint (used to map siteId → region)',
      format: String,
      default: 'https://api-ukair.defra.gov.uk/api/site_meta_datas',
      env: 'RICARDO_API_SITE_METADATA_URL'
    }
  },
  alertTemplates: {
    smsAlert: {
      doc: 'SMS alert template ID for pollutant alerts (English)',
      format: String,
      default: '372e5c47-37b0-445d-8a7a-f3f2a391787c',
      env: 'SMS_ALERT_TEMPLATE_ID'
    },
    smsAlertCy: {
      doc: 'SMS alert template ID for pollutant alerts (Welsh)',
      format: String,
      default: '',
      env: 'SMS_ALERT_CY_TEMPLATE_ID'
    },
    emailAlert: {
      doc: 'Email alert template ID for pollutant alerts (English)',
      format: String,
      default: 'd16e38cd-1d3e-467a-84c9-6bbf4d09c99d',
      env: 'EMAIL_ALERT_TEMPLATE_ID'
    },
    emailAlertCy: {
      doc: 'Email alert template ID for pollutant alerts (Welsh)',
      format: String,
      default: '',
      env: 'EMAIL_ALERT_CY_TEMPLATE_ID'
    },
    checkAirQualityLink: {
      doc: 'Base URL for check air quality link in pollutant alerts',
      format: String,
      default: 'https://check-air-quality.service.gov.uk/location/',
      env: 'CHECK_AIR_QUALITY_LINK'
    }
  },
  daqiAlertTemplates: {
    smsAlert: {
      doc: 'SMS alert template ID for DAQI alerts (English)',
      format: String,
      default: '36c1bc0e-cc1e-4ed1-81cc-8e6bb3cb60de',
      env: 'SMS_DAQI_ALERT_TEMPLATE_ID'
    },
    smsAlertCy: {
      doc: 'SMS alert template ID for DAQI alerts (Welsh)',
      format: String,
      default: '',
      env: 'SMS_DAQI_ALERT_CY_TEMPLATE_ID'
    },
    emailAlert: {
      doc: 'Email alert template ID for DAQI alerts (English)',
      format: String,
      default: 'f4060bf7-0798-42e0-b02c-fe50a1e4e9e1',
      env: 'EMAIL_DAQI_ALERT_TEMPLATE_ID'
    },
    emailAlertCy: {
      doc: 'Email alert template ID for DAQI alerts (Welsh)',
      format: String,
      default: '',
      env: 'EMAIL_DAQI_ALERT_CY_TEMPLATE_ID'
    }
  },
  forecastAlertTemplates: {
    smsAlert: {
      doc: 'SMS forecast alert template ID (English)',
      format: String,
      default: '31e92306-8cf4-415e-b0d9-b928bbbaf97b',
      env: 'SMS_FORECAST_ALERT_TEMPLATE_ID'
    },
    smsAlertCy: {
      doc: 'SMS forecast alert template ID (Welsh)',
      format: String,
      default: '',
      env: 'SMS_FORECAST_ALERT_CY_TEMPLATE_ID'
    },
    emailAlert: {
      doc: 'Email forecast alert template ID (English)',
      format: String,
      default: 'b37ad7b7-eb3a-450d-a4b4-aae0c7f6a574',
      env: 'EMAIL_FORECAST_ALERT_TEMPLATE_ID'
    },
    emailAlertCy: {
      doc: 'Email forecast alert template ID (Welsh)',
      format: String,
      default: '',
      env: 'EMAIL_FORECAST_ALERT_CY_TEMPLATE_ID'
    }
  },
  metOfficeForecast: {
    forecastApiUrl: {
      doc: 'Base URL for the aqie-forecast-api service',
      format: String,
      default: 'http://localhost:3000',
      env: 'FORECAST_API_URL'
    },
    daqiAlertThreshold: {
      doc: 'Minimum DAQI value (inclusive) that triggers an alert',
      format: Number,
      default: 7,
      env: 'DAQI_ALERT_THRESHOLD'
    },
    cronSchedule: {
      doc: 'Cron expression for the daily MetOffice forecast alert job (default: hourly 05:00–10:00 UTC — covers 06:00–11:00 BST and 05:00–10:00 GMT, with the schedule-state guard ensuring only the first tick with current data does the work)',
      format: String,
      default: '0 5-10 * * *',
      env: 'FORECAST_CRON_SCHEDULE'
    }
  },
  isMetricsEnabled: {
    doc: 'Enable metrics reporting',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_METRICS'
  },
  tracing: {
    header: {
      doc: 'CDP tracing header name',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  }
})

config.validate({ allowed: 'strict' })

export { config }
