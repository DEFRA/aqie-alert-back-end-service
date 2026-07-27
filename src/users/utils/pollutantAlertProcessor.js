import { fetchAlerts } from './ricardoApiClient.js'
import { sendNotification } from './notifyServiceClient.js'
import { getRegionForSite } from './ricardoSiteAndRegionCache.js'
import { formatLocationForUrl } from './locationUtils.js'
import { isWithinLast24Hours, TWENTY_FOUR_HOURS_MS } from './dateRangeUtils.js'
import {
  ensureCacheReadyForCycle,
  getMatchingUsers,
  sendNotificationsToUsers
} from './alertCycleUtils.js'
import { deduplicateAlertsOldestFirst } from './alertDedupUtils.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { DB_ERROR_CODE } from './constants.js'

const logger = createLogger()
const POLLUTANT_ALERT_STATUS_COLLECTION = 'pollutant-alert-processing-state'
const POLLUTANT_ALERTS_AUDIT_COLLECTION = 'pollutant-alerts-audit'

function cleanPollutantName(pollutant) {
  return pollutant.replaceAll(/<[^>]{0,200}>/g, '')
}

const POLLUTANT_NAME_MAP = {
  O3: 'ozone',
  NO2: 'nitrogen dioxide',
  SO2: 'sulphur dioxide',
  PM10: 'PM10',
  'PM2.5': 'PM2.5'
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

/**
 * Audit-side key: identifies a SPECIFIC Ricardo emission so each
 * `pollutant-alerts-audit` row traces back to the exact reading that triggered
 * it. Includes `date` so two readings of the same physical breach (a repeat
 * after a >24h gap) produce distinct audit identifiers and therefore distinct
 * audit rows. Unlike DAQI we do not embed siteId — the pollutant audit does not
 * carry it, and samplingPointId already maps to a single site.
 */
function buildAuditKey(member) {
  return `${member.samplingPointId}-${member.date}`
}

/**
 * MongoDB query shape for a NEW event row in `pollutant-alert-processing-state`.
 * Compound key: alert-id (holds samplingPointId) + alert-started-timestamp.
 * Each continuous breach event produces one document. A beyond-24h gap produces
 * a new document (different alert-started-timestamp). The collection has a
 * unique index on `{ 'alert-id': 1, 'alert-started-timestamp': 1 }`.
 */
function buildNewEventStateQuery(alertDetail) {
  return {
    'alert-id': alertDetail.samplingPointId,
    'alert-started-timestamp': alertDetail.date
  }
}

/**
 * MongoDB query shape for updating an EXISTING event row. Uses the
 * alert-started-timestamp from the existing state row so the update targets the
 * correct document for the current event window — not the incoming alert date.
 */
function buildExistingEventStateQuery(samplingPointId, alertStartedTimestamp) {
  return {
    'alert-id': samplingPointId,
    'alert-started-timestamp': alertStartedTimestamp
  }
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
        (item.alertLevel === true || item.informationLevel === true) &&
        item.samplingPointId !== undefined &&
        item.siteId &&
        item.date &&
        isWithinLast24Hours(item.date)
    )
    .map((item) => ({
      samplingPointId: item.samplingPointId,
      'alert-id': buildAuditKey(item),
      siteId: item.siteId,
      date: item.date,
      pollutant: item.pollutant,
      concentration: item.concentration,
      alertThreshold: item.alertThreshold
    }))
}

/**
 * Bulk-loads the most recent state row per samplingPointId (stored under
 * `alert-id`) for all candidates. Sorted by alert-started-timestamp descending
 * so that when multiple event rows exist for the same samplingPointId (each
 * beyond-24h gap creates a new row), the first map.set wins — giving us the
 * latest event row for each id.
 * @returns {Promise<Map<number, object>>}
 */
async function loadRecentStateRowsByAlertId(db, candidates) {
  if (candidates.length === 0) {
    return new Map()
  }
  const alertIds = candidates.map((c) => c.samplingPointId)
  const rows = await db
    .collection(POLLUTANT_ALERT_STATUS_COLLECTION)
    .find({ 'alert-id': { $in: alertIds } })
    .sort({ 'alert-started-timestamp': -1 })
    .toArray()
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row['alert-id'])) {
      map.set(row['alert-id'], row)
    }
  }
  return map
}

async function markAlertInProgress(db, alertDetail) {
  // New event row: compound key (alert-id + alert-started-timestamp).
  // Beyond-24h gap → different alert-started-timestamp → new document inserted.
  // Within-24h repeat is routed to updateStateForExistingAlert, not here.
  await db.collection(POLLUTANT_ALERT_STATUS_COLLECTION).updateOne(
    buildNewEventStateQuery(alertDetail),
    {
      $set: {
        'alert-id': alertDetail.samplingPointId,
        region: alertDetail.region,
        pollutant: alertDetail.pollutant,
        concentration: alertDetail.concentration,
        alertThreshold: alertDetail.alertThreshold,
        lastUpdatedFromRicardo: alertDetail.date,
        status: 'in-progress',
        'alert-started-timestamp': alertDetail.date
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  )
}

async function markAlertProcessed(db, alertDetail) {
  await db
    .collection(POLLUTANT_ALERT_STATUS_COLLECTION)
    .updateOne(buildNewEventStateQuery(alertDetail), {
      $set: {
        status: 'processed',
        processedAt: new Date()
      }
    })
}

/**
 * Bumps `lastUpdatedFromRicardo` (and last-seen `concentration`) for a combo
 * whose users were already notified within the 24h window. No notification is
 * sent and no audit row is written — the row is just kept current for
 * traceability. Uses the existing row's alert-started-timestamp to target the
 * correct event document, not the incoming alert date.
 */
async function updateStateForExistingAlert(db, alertDetail, existingRow) {
  await db
    .collection(POLLUTANT_ALERT_STATUS_COLLECTION)
    .updateOne(
      buildExistingEventStateQuery(
        alertDetail.samplingPointId,
        existingRow['alert-started-timestamp']
      ),
      {
        $set: {
          lastUpdatedFromRicardo: alertDetail.date,
          concentration: alertDetail.concentration
        }
      }
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
    await db.collection(POLLUTANT_ALERTS_AUDIT_COLLECTION).insertOne(entry)
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
  await db.collection(POLLUTANT_ALERTS_AUDIT_COLLECTION).updateOne(
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

    const allSent = await sendNotificationsToUsers({
      db,
      alertDetail: resolvedDetail,
      matchedUsers,
      logPrefix: '[Pollutant]',
      insertAuditEntry: insertPollutantAuditEntry,
      updateAuditEntry: updatePollutantAuditEntry,
      sendAlert: sendAlertToUser
    })

    if (allSent) {
      await markAlertProcessed(db, resolvedDetail)
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

/**
 * Classifies one alert against its (optional) existing state row.
 *
 * Business rule: the 24h dedup window is anchored to `lastUpdatedFromRicardo`
 * (the last Ricardo reading we recorded for this combo). As long as we keep
 * seeing this samplingPointId in Ricardo's response at least every 24h, we
 * treat it as one continuous event and don't re-notify. If Ricardo goes quiet
 * for >24h and the breach then reappears, that's a fresh event → notify again.
 *
 *   'skip-stuck'  — a prior cycle marked the combo in-progress and never
 *                   finished (the mongo-lock guarantees serial cycles, so a
 *                   leftover 'in-progress' at cycle start means it crashed).
 *   'update-only' — the combo was last seen by Ricardo within 24h; bump
 *                   lastUpdatedFromRicardo, do not re-notify.
 *   'new'         — no row, OR Ricardo hasn't confirmed this combo for >24h.
 */
function classifyAlert(existingRow, now) {
  if (!existingRow) {
    return 'new'
  }
  if (existingRow.status === 'in-progress') {
    return 'skip-stuck'
  }
  const lastUpdatedMs = existingRow.lastUpdatedFromRicardo
    ? new Date(existingRow.lastUpdatedFromRicardo).getTime()
    : 0
  if (now - lastUpdatedMs <= TWENTY_FOUR_HOURS_MS) {
    return 'update-only'
  }
  return 'new'
}

export async function processPollutantAlerts(db) {
  logger.info('[Pollutant] Starting pollutant alert processing cycle')

  const alertData = await fetchPollutantAlertsForCycle()
  if (!alertData) {
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
      '[Pollutant] No alerts matching alertLevel/informationLevel=true, validationStatus=2 and within 24h'
    )
    return
  }

  // Collapse rows in this response that share the same samplingPointId.
  // Cron-job rule: oldest timestamp wins (breach-started time), highest
  // concentration as tie-breaker when timestamps are equal. This ensures the
  // notification reflects when the breach first occurred, not Ricardo's latest
  // refresh, and the most severe reading in a tie.
  const uniqueCandidates = deduplicateAlertsOldestFirst(
    validAlerts,
    'concentration'
  )
  logger.info(
    `[Pollutant] ${uniqueCandidates.length} unique candidate alerts (${validAlerts.length - uniqueCandidates.length} in-cycle duplicates collapsed by samplingPointId)`
  )

  if (!(await ensureCacheReadyForCycle('[Pollutant]'))) {
    return
  }

  // One bulk read for all candidate samplingPointIds, then classify each.
  const stateByAlertId = await loadRecentStateRowsByAlertId(
    db,
    uniqueCandidates
  )
  const now = Date.now()
  const counts = { new: 0, 'update-only': 0, 'skip-stuck': 0 }

  for (const alertDetail of uniqueCandidates) {
    const existing = stateByAlertId.get(alertDetail.samplingPointId)
    const verdict = classifyAlert(existing, now)
    counts[verdict]++

    if (verdict === 'skip-stuck') {
      logger.info(
        `[Pollutant] Skipping samplingPointId ${alertDetail.samplingPointId}: prior cycle left it in-progress (likely crashed mid-process — manual review needed)`
      )
      continue
    }

    if (verdict === 'update-only') {
      await updateStateForExistingAlert(db, alertDetail, existing)
      logger.info(
        `[Pollutant] Update-only for samplingPointId ${alertDetail.samplingPointId} (last Ricardo reading at ${existing.lastUpdatedFromRicardo}, within 24h)`
      )
      continue
    }

    // verdict === 'new'
    await processAlertForUsers(db, alertDetail)
  }

  logger.info(
    `[Pollutant] Cycle summary ${JSON.stringify({
      candidates: uniqueCandidates.length,
      new: counts.new,
      updateOnly: counts['update-only'],
      skipStuck: counts['skip-stuck']
    })}`
  )
  logger.info('[Pollutant] Pollutant alert processing cycle completed')
}

export {
  filterValidAlerts,
  getMatchingUsers,
  cleanPollutantName,
  formatPollutantName,
  markAlertInProgress,
  markAlertProcessed,
  updateStateForExistingAlert,
  sendAlertToUser,
  classifyAlert,
  buildAuditKey
}
