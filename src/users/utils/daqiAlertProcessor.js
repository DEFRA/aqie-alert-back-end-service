import { fetchDaqiAlerts } from './ricardoApiClient.js'
import { sendNotification } from './notifyServiceClient.js'
import { getRegionForSite } from './ricardoSiteAndRegionCache.js'
import { formatLocationForUrl } from './locationUtils.js'
import {
  cleanPollutantName,
  formatPollutantName
} from './pollutantAlertProcessor.js'
import { getRollingDayWindow } from './dateRangeUtils.js'
import {
  collapseInCycleDuplicates,
  ensureCacheReadyForCycle,
  getMatchingUsers
} from './alertCycleUtils.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { DB_ERROR_CODE } from './constants.js'

const logger = createLogger()
const DAQI_ALERT_STATUS_COLLECTION = 'daqi-alert-processing-state'
const DAQI_ALERTS_AUDIT_COLLECTION = 'daqi-alerts-audit'

function buildAlertKey(member) {
  return `${member.samplingPointId}-${member.siteId}-${member.date}`
}

function filterValidDaqiAlerts(members, threshold) {
  // Note: Ricardo's own `region` field is deliberately NOT carried through.
  // Region is always resolved from siteId via the GeoJSON-backed site cache in
  // processAlertForUsers, because Ricardo's region is coarse (it does not
  // sub-divide Scotland/Wales) and would not match the finer regions used for
  // USERS locations.
  return members
    .filter(
      (item) =>
        item.daqi >= threshold &&
        item.validationStatus === 2 &&
        item.samplingPointId !== undefined &&
        item.siteId &&
        item.date
    )
    .map((item) => ({
      'alert-id': buildAlertKey(item),
      samplingPointId: item.samplingPointId,
      siteId: item.siteId,
      date: item.date,
      daqi: item.daqi,
      level: item.level,
      pollutant: item.pollutant
    }))
}

async function getAlreadyProcessedAlertKeys(db) {
  const existing = await db
    .collection(DAQI_ALERT_STATUS_COLLECTION)
    .find({ 'process-status': { $in: ['in-progress', 'processed'] } })
    .project({ samplingPointId: 1, siteId: 1, date: 1 })
    .toArray()
  return new Set(
    existing.map((doc) => `${doc.samplingPointId}-${doc.siteId}-${doc.date}`)
  )
}

async function markAlertInProgress(db, alertDetail) {
  await db.collection(DAQI_ALERT_STATUS_COLLECTION).updateOne(
    {
      samplingPointId: alertDetail.samplingPointId,
      siteId: alertDetail.siteId,
      date: alertDetail.date
    },
    {
      $set: {
        'alert-id': alertDetail['alert-id'],
        samplingPointId: alertDetail.samplingPointId,
        siteId: alertDetail.siteId,
        date: alertDetail.date,
        daqi: alertDetail.daqi,
        region: alertDetail.region,
        pollutant: alertDetail.pollutant,
        'process-status': 'in-progress',
        'alert-started-timestamp': new Date()
      }
    },
    { upsert: true }
  )
}

async function markAlertProcessed(db, alertDetail) {
  await db.collection(DAQI_ALERT_STATUS_COLLECTION).updateOne(
    {
      samplingPointId: alertDetail.samplingPointId,
      siteId: alertDetail.siteId,
      date: alertDetail.date
    },
    {
      $set: {
        'process-status': 'processed',
        processedAt: new Date()
      }
    }
  )
}

async function insertDaqiAuditEntry(db, alertDetail, userMatch) {
  const entry = {
    'alert-id': alertDetail['alert-id'],
    samplingPointId: alertDetail.samplingPointId,
    siteId: alertDetail.siteId,
    date: alertDetail.date,
    daqi: alertDetail.daqi,
    region: alertDetail.region,
    pollutant: cleanPollutantName(alertDetail.pollutant),
    user_contact: userMatch.userContact,
    alertType: userMatch.alertType,
    lang: userMatch.lang,
    location: userMatch.location,
    'daqi-alert-status': 'not-processed',
    notificationId: null,
    timestamp: new Date()
  }
  try {
    await db.collection(DAQI_ALERTS_AUDIT_COLLECTION).insertOne(entry)
  } catch (err) {
    if (err.code === DB_ERROR_CODE) {
      logger.warn(
        `[DAQI] Duplicate audit entry skipped ${JSON.stringify({ 'alert-id': alertDetail['alert-id'], user_contact: userMatch.userContact, location: userMatch.location })}`
      )
    } else {
      throw err
    }
  }
  return entry
}

async function updateDaqiAuditEntry(
  db,
  alertId,
  userContact,
  location,
  notificationId
) {
  await db.collection(DAQI_ALERTS_AUDIT_COLLECTION).updateOne(
    {
      'alert-id': alertId,
      user_contact: userContact,
      location,
      'daqi-alert-status': 'not-processed'
    },
    {
      $set: {
        'daqi-alert-status': 'processed',
        notificationId
      }
    }
  )
}

function getTemplateId(alertType, lang) {
  const isWelsh = lang === 'cy'
  if (alertType === 'sms') {
    return isWelsh
      ? config.get('daqiAlertTemplates.smsAlertCy')
      : config.get('daqiAlertTemplates.smsAlert')
  }
  return isWelsh
    ? config.get('daqiAlertTemplates.emailAlertCy')
    : config.get('daqiAlertTemplates.emailAlert')
}

async function sendAlertToUser(userMatch, alertDetail) {
  const lang = userMatch.lang || 'en'
  const templateId = getTemplateId(userMatch.alertType, lang)
  const locationSlug = formatLocationForUrl(userMatch.location)
  const checkAirQualityBaseUrl = config.get(
    'alertTemplates.checkAirQualityLink'
  )
  const checkAirQualityLink = `${checkAirQualityBaseUrl}${locationSlug}?lang=${lang}`

  const payload = {
    templateId,
    alertId: String(alertDetail['alert-id']),
    personalisation: {
      location: userMatch.location,
      daqi: String(alertDetail.daqi),
      Pollutant: formatPollutantName(alertDetail.pollutant),
      checkAirQualityLink
    }
  }

  if (userMatch.alertType === 'sms') {
    payload.phoneNumber = userMatch.userContact
  } else {
    payload.emailAddress = userMatch.userContact
    const unsubscribeBaseUrl = config.get(
      'notification.templates.unsubscribeEmailLink'
    )
    payload.personalisation.unsubscribeLink = `${unsubscribeBaseUrl}?email=${encodeURIComponent(userMatch.userContact)}`
  }

  const requestId = `daqi-alert-${alertDetail['alert-id']}-${Date.now()}`
  const responseBody = await sendNotification(payload, requestId)

  return responseBody?.notificationId ?? null
}

async function processAlertForUsers(db, alertDetail) {
  try {
    const region = getRegionForSite(alertDetail.siteId)
    if (!region) {
      // Cache is healthy (the cycle-level guard ensures that) but this siteId
      // is unknown. We never trust Ricardo's coarse region, so without a cache
      // hit we cannot reliably match users — skip and leave it unprocessed so a
      // later cycle can retry once the site appears in the cache.
      logger.info(
        `[DAQI] Alert ${alertDetail['alert-id']}: siteId "${alertDetail.siteId}" not found in site cache; cannot resolve region, skipping`
      )
      return
    }
    const resolvedDetail = { ...alertDetail, region }

    await markAlertInProgress(db, resolvedDetail)

    const users = await db
      .collection('USERS')
      .find({ 'locations.region': resolvedDetail.region })
      .toArray()

    const matchedUsers = getMatchingUsers(users, resolvedDetail.region)
    logger.info(
      `[DAQI] Alert ${resolvedDetail['alert-id']}: matched ${matchedUsers.length} user-location pairs in region "${resolvedDetail.region}"`
    )

    let allSent = true
    for (const userMatch of matchedUsers) {
      await insertDaqiAuditEntry(db, resolvedDetail, userMatch)
      try {
        const notificationId = await sendAlertToUser(userMatch, resolvedDetail)
        await updateDaqiAuditEntry(
          db,
          resolvedDetail['alert-id'],
          userMatch.userContact,
          userMatch.location,
          notificationId
        )
        logger.info(
          `[DAQI] Notification sent for alert ${resolvedDetail['alert-id']} to ${userMatch.alertType} user, notificationId: ${notificationId}`
        )
      } catch (err) {
        allSent = false
        logger.error(
          `[DAQI] Failed to send notification for alert ${resolvedDetail['alert-id']} ${JSON.stringify({ alertType: userMatch.alertType, error: err.message })}`
        )
      }
    }

    if (allSent) {
      await markAlertProcessed(db, resolvedDetail)
      logger.info(
        `[DAQI] Alert ${resolvedDetail['alert-id']} marked as processed`
      )
    }
  } catch (err) {
    logger.error(
      `[DAQI] Error processing alert ${alertDetail['alert-id']} ${JSON.stringify({ error: err.message })}`
    )
  }
}

async function fetchDaqiAlertsForCycle() {
  const { startDate, endDate } = getRollingDayWindow()
  try {
    return await fetchDaqiAlerts({ startDate, endDate })
  } catch (err) {
    logger.error(
      `[DAQI] Failed to fetch Ricardo DAQI alerts ${JSON.stringify({ upstreamStatus: err.status ?? null, error: err.message })}`
    )
    return null
  }
}

export async function processDaqiAlerts(db) {
  logger.info('[DAQI] Starting DAQI alert processing cycle')

  const alertData = await fetchDaqiAlertsForCycle()
  if (!alertData) return

  const members = alertData.member ?? []
  if (members.length === 0) {
    logger.info('[DAQI] No alert members returned from Ricardo DAQI API')
    return
  }

  const threshold = config.get('metOfficeForecast.daqiAlertThreshold')
  const validAlerts = filterValidDaqiAlerts(members, threshold)
  logger.info(
    `[DAQI] Filtered ${validAlerts.length} valid alerts from ${members.length} total (daqi>=${threshold}, validationStatus=2)`
  )
  if (validAlerts.length === 0) return

  const processedKeys = await getAlreadyProcessedAlertKeys(db)
  const newAlerts = validAlerts.filter(
    (alert) => !processedKeys.has(alert['alert-id'])
  )
  const uniqueNewAlerts = collapseInCycleDuplicates(newAlerts)

  logger.info(
    `[DAQI] ${uniqueNewAlerts.length} unique alerts to process (${newAlerts.length - uniqueNewAlerts.length} duplicate rows collapsed, ${processedKeys.size} already processed in prior cycles)`
  )
  if (uniqueNewAlerts.length === 0) return

  if (!(await ensureCacheReadyForCycle('[DAQI]'))) return

  for (const alertDetail of uniqueNewAlerts) {
    await processAlertForUsers(db, alertDetail)
  }

  logger.info('[DAQI] DAQI alert processing cycle completed')
}

export {
  filterValidDaqiAlerts,
  getMatchingUsers,
  getAlreadyProcessedAlertKeys,
  markAlertInProgress,
  markAlertProcessed,
  sendAlertToUser,
  buildAlertKey
}
