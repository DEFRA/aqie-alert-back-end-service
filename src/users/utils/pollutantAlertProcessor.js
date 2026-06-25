import { fetchAlerts } from './ricardoApiClient.js'
import { sendNotification } from './notifyServiceClient.js'
import {
  getRegionForSite,
  getSiteCacheSize,
  ensureSiteCachePopulated
} from './ricardoSiteAndRegionCache.js'
import { formatLocationForUrl } from './locationUtils.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { DB_ERROR_CODE } from './constants.js'

const logger = createLogger()
const POLLUTANT_ALERT_STATUS_COLLECTION = 'pollutant-alert-processing-state'

function cleanPollutantName(pollutant) {
  return pollutant.replaceAll(/<[^>]{0,200}>/g, '')
}

const POLLUTANT_NAME_MAP = {
  O3: 'ozone',
  NO2: 'nitrogen dioxide',
  SO2: 'sulphur dioxide',
  CO: 'carbon monoxide',
  PM10: 'PM10',
  'PM2.5': 'PM2.5',
  NO: 'nitrogen monoxide',
  C6H6: 'benzene',
  Pb: 'lead',
  '1,3-BD': '1,3-butadiene'
}

function formatPollutantName(pollutant) {
  const cleaned = cleanPollutantName(pollutant)
  const match = cleaned.match(/\(([^)]{1,20})\)/)
  if (!match) {
    return cleaned
  }
  const code = match[1]
  const name = POLLUTANT_NAME_MAP[code]
  return name ? `${name} (${code})` : cleaned
}

function filterValidAlerts(members) {
  // Note: Ricardo's own `region` field is deliberately NOT carried through.
  // Region is always resolved from siteId via the GeoJSON-backed site cache in
  // processAlertForUsers, because Ricardo's region is coarse (it does not
  // sub-divide Scotland/Wales) and would not match the finer regions used for
  // USERS locations.
  return members
    .filter(
      (item) =>
        item.validationStatus === 2 &&
        (item.alertLevel === true || item.informationLevel === true)
    )
    .map((item) => ({
      'alert-id': item.samplingPointId,
      siteId: item.siteId,
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

  const requestId = `alert-${alertDetail['alert-id']}-${Date.now()}`
  const responseBody = await sendNotification(payload, requestId)

  const notificationId = responseBody?.notificationId ?? null
  return notificationId
}

async function processAlertForUsers(db, alertDetail) {
  try {
    const region = getRegionForSite(alertDetail.siteId)
    if (!region) {
      // Cache is healthy (the cycle-level guard ensures that) but this siteId
      // is unknown. We never trust Ricardo's coarse region, so without a cache
      // hit we cannot reliably match users — skip and leave it unprocessed so a
      // later cycle can retry once the site appears in the cache.
      logger.warn(
        `[Pollutant] Alert ${alertDetail['alert-id']}: siteId "${alertDetail.siteId}" not found in site cache; cannot resolve region, skipping`
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
      `[Pollutant] Alert ${resolvedDetail['alert-id']}: matched ${matchedUsers.length} user-location pairs in region "${resolvedDetail.region}"`
    )

    let allSent = true
    for (const userMatch of matchedUsers) {
      await insertPollutantAuditEntry(db, resolvedDetail, userMatch)
      try {
        const notificationId = await sendAlertToUser(userMatch, resolvedDetail)
        await updatePollutantAuditEntry(
          db,
          resolvedDetail['alert-id'],
          userMatch.userContact,
          userMatch.location,
          notificationId
        )
        logger.info(
          `[Pollutant] Notification sent for alert ${resolvedDetail['alert-id']} to ${userMatch.alertType} user, notificationId: ${notificationId}`
        )
      } catch (err) {
        allSent = false
        logger.error(
          `[Pollutant] Failed to send notification for alert ${resolvedDetail['alert-id']} ${JSON.stringify({ alertType: userMatch.alertType, error: err.message })}`
        )
      }
    }

    if (allSent) {
      await markAlertProcessed(db, resolvedDetail['alert-id'])
      logger.info(
        `[Pollutant] Alert ${resolvedDetail['alert-id']} marked as processed`
      )
    }
  } catch (err) {
    logger.error(
      `[Pollutant] Error processing alert ${alertDetail['alert-id']} ${JSON.stringify({ error: err.message })}`
    )
  }
}

// Ricardo returns one row per hourly breach, so the same samplingPointId
// (== alert-id) can appear multiple times in a single response. Without
// collapsing here, every row would call sendAlertToUser even though the
// audit unique index `{alert-id, user_contact, location}` rejects the
// second insert — resulting in duplicate Notify calls. Keep the first
// occurrence per alert-id; Ricardo orders newest-first, so that's the most
// recent measurement.
function collapseInCycleDuplicates(alerts) {
  const seen = new Set()
  const unique = []
  for (const alert of alerts) {
    if (!seen.has(alert['alert-id'])) {
      seen.add(alert['alert-id'])
      unique.push(alert)
    }
  }
  return unique
}

// Region resolution depends entirely on the site cache. If it's empty the
// startup fetch likely failed — try one on-demand refresh, and skip the cycle
// rather than skipping every alert one by one. Returns true when the cache is
// usable, false when the caller should abort the cycle.
async function ensureCacheReadyForCycle() {
  if (getSiteCacheSize() > 0) {
    return true
  }
  const populated = await ensureSiteCachePopulated()
  if (populated) {
    return true
  }
  logger.info(
    '[Pollutant] Site cache empty and refresh failed; skipping cycle (will retry on next run)'
  )
  return false
}

async function fetchPollutantAlertsForCycle() {
  try {
    return await fetchAlerts()
  } catch (err) {
    logger.error(
      `[Pollutant] Failed to fetch Ricardo alerts ${JSON.stringify({ upstreamStatus: err.status ?? null, error: err.message })}`
    )
    return null
  }
}

export async function processPollutantAlerts(db) {
  logger.info('[Pollutant] Starting pollutant alert processing cycle')

  const alertData = await fetchPollutantAlertsForCycle()
  if (!alertData) return

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
  const uniqueNewAlerts = collapseInCycleDuplicates(newAlerts)

  logger.info(
    `[Pollutant] ${uniqueNewAlerts.length} unique alerts to process (${newAlerts.length - uniqueNewAlerts.length} duplicate rows collapsed, ${processedIds.size} already processed in prior cycles)`
  )
  if (uniqueNewAlerts.length === 0) return

  if (!(await ensureCacheReadyForCycle())) return

  for (const alertDetail of uniqueNewAlerts) {
    await processAlertForUsers(db, alertDetail)
  }

  logger.info('[Pollutant] Pollutant alert processing cycle completed')
}

export {
  filterValidAlerts,
  getMatchingUsers,
  cleanPollutantName,
  formatPollutantName,
  getAlreadyProcessedAlertIds,
  markAlertInProgress,
  markAlertProcessed,
  sendAlertToUser
}
