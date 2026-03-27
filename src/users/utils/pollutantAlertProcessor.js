import { fetchAlerts } from './ricardoApiClient.js'
import { sendNotification } from './notifyServiceClient.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

function cleanPollutantName(pollutant) {
  return pollutant.replace(/<[^>]*>/g, '')
}

function filterValidAlerts(members) {
  return members
    .filter((item) => item.alertLevel === true && item.validationStatus === 2)
    .map((item) => ({
      'alert-id': item.samplingPointId,
      region: item.region,
      pollutant: item.pollutant,
      alertText: item.alertText,
      concentration: item.concentration,
      alertThreshold: item.alertThreshold
    }))
}

async function getAlreadyProcessedAlertIds(db) {
  const existing = await db
    .collection('alert-details')
    .find({ status: { $in: ['in-progress', 'processed'] } })
    .project({ 'alert-id': 1 })
    .toArray()
  return new Set(existing.map((doc) => doc['alert-id']))
}

async function markAlertInProgress(db, alertDetail) {
  await db.collection('alert-details').updateOne(
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

async function markAlertProcessed(db, alertId) {
  await db.collection('alert-details').updateOne(
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
  if (!location) return ''
  const trimmed = location.trim()
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((part) => part.trim().toLowerCase().replace(/\s+/g, '-'))
      .join('_')
  }
  return trimmed.toLowerCase().replace(/\s+/g, '')
}

function getMatchingUsers(users, alertRegion) {
  const results = []
  for (const user of users) {
    const matchingLocations = (user.locations || []).filter(
      (loc) => loc.region === alertRegion
    )
    if (matchingLocations.length > 0) {
      for (const loc of matchingLocations) {
        results.push({
          userContact: user.user_contact,
          alertType: user.alertType,
          location: loc.location,
          lang: user.lang || 'en'
        })
      }
    }
  }
  return results
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

export async function processPollutantAlerts(db) {
  logger.info('Starting pollutant alert processing cycle')

  let alertData
  try {
    alertData = await fetchAlerts()
  } catch (err) {
    logger.error(
      `Failed to fetch Ricardo alerts ${JSON.stringify({ error: err.message })}`
    )
    return
  }

  const members = alertData.member || []
  if (members.length === 0) {
    logger.info('No alert members returned from Ricardo API')
    return
  }

  const validAlerts = filterValidAlerts(members)
  logger.info(
    `Filtered ${validAlerts.length} valid alerts from ${members.length} total`
  )

  if (validAlerts.length === 0) {
    logger.info('No alerts matching alertLevel=true and validationStatus=2')
    return
  }

  const processedIds = await getAlreadyProcessedAlertIds(db)
  const newAlerts = validAlerts.filter(
    (alert) => !processedIds.has(alert['alert-id'])
  )

  logger.info(
    `${newAlerts.length} new alerts to process (${processedIds.size} already processed)`
  )

  if (newAlerts.length === 0) {
    return
  }

  for (const alertDetail of newAlerts) {
    try {
      await markAlertInProgress(db, alertDetail)

      const users = await db
        .collection('USERS')
        .find({ 'locations.region': alertDetail.region })
        .toArray()

      const matchedUsers = getMatchingUsers(users, alertDetail.region)
      logger.info(
        `Alert ${alertDetail['alert-id']}: matched ${matchedUsers.length} user-location pairs in region "${alertDetail.region}"`
      )

      let allSent = true
      for (const userMatch of matchedUsers) {
        try {
          const notificationId = await sendAlertToUser(userMatch, alertDetail)
          logger.info(
            `Notification sent for alert ${alertDetail['alert-id']} to ${userMatch.alertType} user, notificationId: ${notificationId}`
          )
        } catch (err) {
          allSent = false
          logger.error(
            `Failed to send notification for alert ${alertDetail['alert-id']} ${JSON.stringify(
              {
                alertType: userMatch.alertType,
                error: err.message
              }
            )}`
          )
        }
      }

      if (allSent) {
        await markAlertProcessed(db, alertDetail['alert-id'])
        logger.info(`Alert ${alertDetail['alert-id']} marked as processed`)
      }
    } catch (err) {
      logger.error(
        `Error processing alert ${alertDetail['alert-id']} ${JSON.stringify({ error: err.message })}`
      )
    }
  }

  logger.info('Pollutant alert processing cycle completed')
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
