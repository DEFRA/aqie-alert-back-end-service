import { fetchAlerts } from './ricardoApiClient.js'
import { sendNotification } from './notifyServiceClient.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()
const POLLUTANT_ALERT_STATUS_COLLECTION = 'pollutant-alert-processing-state'
const DB_ERROR_CODE = 11000

function cleanPollutantName(pollutant) {
  return pollutant.replaceAll(/<[^>]{0,200}>/g, '')
}

function parseRegion(rawRegion) {
  if (!rawRegion) {
    return rawRegion
  }
  try {
    const parsed = JSON.parse(rawRegion)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed[0]
    }
  } catch {
    // not JSON-encoded, use as-is
  }
  return rawRegion
}

function filterValidAlerts(members) {
  return members
    .filter((item) => item.alertLevel === true && item.validationStatus === 2)
    .map((item) => ({
      'alert-id': item.samplingPointId,
      region: parseRegion(item.region),
      pollutant: item.pollutant,
      alertText: item.alertText,
      concentration: item.concentration,
      alertThreshold: item.alertThreshold
    }))
}

async function getAlreadyProcessedAlertIds(db) {
  const existing = await db
    .collection(POLLUTANT_ALERT_STATUS_COLLECTION)
    .find({ status: { $in: ['in-progress', 'processed'] } })
    .project({ 'alert-id': 1 })
    .toArray()
  return new Set(existing.map((doc) => doc['alert-id']))
}

async function markAlertInProgress(db, alertDetail) {
  await db.collection(POLLUTANT_ALERT_STATUS_COLLECTION).updateOne(
    { 'alert-id': alertDetail['alert-id'] },
    {
      $set: {
        'alert-id': alertDetail['alert-id'],
        region: alertDetail.region,
        pollutant: alertDetail.pollutant,
        alertText: alertDetail.alertText,
        concentration: alertDetail.concentration,
        alertThreshold: alertDetail.alertThreshold,
        status: 'in-progress',
        createdAt: new Date()
      }
    },
    { upsert: true }
  )
}

async function insertPollutantAuditEntry(db, alertDetail, userMatch) {
  const entry = {
    'alert-id': alertDetail['alert-id'],
    region: alertDetail.region,
    pollutant: cleanPollutantName(alertDetail.pollutant),
    user_contact: userMatch.userContact,
    alertType: userMatch.alertType,
    lang: userMatch.lang,
    location: userMatch.location,
    'pollutant-alert-status': 'not-processed',
    notificationId: null,
    timestamp: new Date()
  }
  try {
    await db.collection('pollutant-alerts-audit').insertOne(entry)
  } catch (err) {
    if (err.code === DB_ERROR_CODE) {
      logger.warn(
        `[Pollutant] Duplicate audit entry skipped ${JSON.stringify({ 'alert-id': alertDetail['alert-id'], user_contact: userMatch.userContact, location: userMatch.location })}`
      )
    } else {
      throw err
    }
  }
  return entry
}

async function updatePollutantAuditEntry(
  db,
  alertId,
  userContact,
  location,
  notificationId
) {
  await db.collection('pollutant-alerts-audit').updateOne(
    {
      'alert-id': alertId,
      user_contact: userContact,
      location,
      'pollutant-alert-status': 'not-processed'
    },
    {
      $set: {
        'pollutant-alert-status': 'processed',
        notificationId
      }
    }
  )
}

async function markAlertProcessed(db, alertId) {
  await db.collection(POLLUTANT_ALERT_STATUS_COLLECTION).updateOne(
    { 'alert-id': alertId },
    {
      $set: {
        status: 'processed',
        processedAt: new Date()
      }
    }
  )
}

function formatLocationForUrl(location) {
  if (!location) {
    return ''
  }
  const trimmed = location.trim()
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((part) => part.trim().toLowerCase().replaceAll(/\s+/g, '-'))
      .join('_')
  }
  return trimmed.toLowerCase().replaceAll(/\s+/g, '')
}

function getMatchingUsers(users, alertRegion) {
  return users.flatMap((user) =>
    (user.locations ?? [])
      .filter((loc) => loc.region === alertRegion)
      .map((loc) => ({
        userContact: user.user_contact,
        alertType: user.alertType,
        location: loc.location,
        lang: user.lang ?? 'en'
      }))
  )
}

function getTemplateId(alertType, lang) {
  const isWelsh = lang === 'cy'
  if (alertType === 'sms') {
    return isWelsh
      ? config.get('alertTemplates.smsAlertCy')
      : config.get('alertTemplates.smsAlert')
  }
  return isWelsh
    ? config.get('alertTemplates.emailAlertCy')
    : config.get('alertTemplates.emailAlert')
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
      concentration: String(alertDetail.concentration),
      Pollutant: cleanPollutantName(alertDetail.pollutant),
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

  const requestId = `alert-${alertDetail['alert-id']}-${Date.now()}`
  const responseBody = await sendNotification(payload, requestId)

  const notificationId = responseBody?.notificationId ?? null
  return notificationId
}

async function processAlertForUsers(db, alertDetail) {
  try {
    await markAlertInProgress(db, alertDetail)

    const users = await db
      .collection('USERS')
      .find({ 'locations.region': alertDetail.region })
      .toArray()

    const matchedUsers = getMatchingUsers(users, alertDetail.region)
    logger.info(
      `[Pollutant] Alert ${alertDetail['alert-id']}: matched ${matchedUsers.length} user-location pairs in region "${alertDetail.region}"`
    )

    let allSent = true
    for (const userMatch of matchedUsers) {
      await insertPollutantAuditEntry(db, alertDetail, userMatch)
      try {
        const notificationId = await sendAlertToUser(userMatch, alertDetail)
        await updatePollutantAuditEntry(
          db,
          alertDetail['alert-id'],
          userMatch.userContact,
          userMatch.location,
          notificationId
        )
        logger.info(
          `[Pollutant] Notification sent for alert ${alertDetail['alert-id']} to ${userMatch.alertType} user, notificationId: ${notificationId}`
        )
      } catch (err) {
        allSent = false
        logger.error(
          `[Pollutant] Failed to send notification for alert ${alertDetail['alert-id']} ${JSON.stringify({ alertType: userMatch.alertType, error: err.message })}`
        )
      }
    }

    if (allSent) {
      await markAlertProcessed(db, alertDetail['alert-id'])
      logger.info(
        `[Pollutant] Alert ${alertDetail['alert-id']} marked as processed`
      )
    }
  } catch (err) {
    logger.error(
      `[Pollutant] Error processing alert ${alertDetail['alert-id']} ${JSON.stringify({ error: err.message })}`
    )
  }
}

export async function processPollutantAlerts(db) {
  logger.info('[Pollutant] Starting pollutant alert processing cycle')

  let alertData
  try {
    alertData = await fetchAlerts()
  } catch (err) {
    logger.error(
      `[Pollutant] Failed to fetch Ricardo alerts ${JSON.stringify({ error: err.message })}`
    )
    return
  }

  const members = alertData.member ?? []
  if (members.length === 0) {
    logger.info('[Pollutant] No alert members returned from Ricardo API')
    return
  }

  const validAlerts = filterValidAlerts(members)
  logger.info(
    `[Pollutant] Filtered ${validAlerts.length} valid alerts from ${members.length} total`
  )

  if (validAlerts.length === 0) {
    logger.info(
      '[Pollutant] No alerts matching alertLevel=true and validationStatus=2'
    )
    return
  }

  const processedIds = await getAlreadyProcessedAlertIds(db)
  const newAlerts = validAlerts.filter(
    (alert) => !processedIds.has(alert['alert-id'])
  )

  logger.info(
    `[Pollutant] ${newAlerts.length} new alerts to process (${processedIds.size} already processed)`
  )

  if (newAlerts.length === 0) {
    return
  }

  for (const alertDetail of newAlerts) {
    await processAlertForUsers(db, alertDetail)
  }

  logger.info('[Pollutant] Pollutant alert processing cycle completed')
}

export {
  filterValidAlerts,
  getMatchingUsers,
  cleanPollutantName,
  formatLocationForUrl,
  getAlreadyProcessedAlertIds,
  markAlertInProgress,
  markAlertProcessed,
  sendAlertToUser
}
