import { fetchDaqiAlerts } from './ricardoApiClient.js'
import { sendNotification } from './notifyServiceClient.js'
import { getRegionForSite } from './ricardoSiteAndRegionCache.js'
import { formatLocationForUrl } from './locationUtils.js'
import { cleanPollutantName } from './pollutantAlertProcessor.js'
import {
  getRollingDayWindow,
  isWithinLast24Hours,
  TWENTY_FOUR_HOURS_MS
} from './dateRangeUtils.js'
import {
  collapseInCycleDuplicates,
  ensureCacheReadyForCycle,
  getMatchingUsers,
  sendNotificationsToUsers
} from './alertCycleUtils.js'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { DB_ERROR_CODE, DAQI_VERY_HIGH_THRESHOLD } from './constants.js'

const logger = createLogger()
const DAQI_ALERT_STATUS_COLLECTION = 'daqi-alert-processing-state'
const DAQI_ALERTS_AUDIT_COLLECTION = 'daqi-alerts-audit'

/**
 * Audit-side key: identifies a SPECIFIC Ricardo emission so each
 * `daqi-alerts-audit` row traces back to the exact alert payload that
 * triggered it. Includes `date` so two readings of the same physical breach
 * produce distinct audit identifiers.
 */
function buildAlertKey(member) {
  return `${member.samplingPointId}-${member.siteId}-${member.date}`
}

/**
 * MongoDB query shape for a NEW event row in `daqi-alert-processing-state`.
 * Compound key: samplingPointId + alert-started-timestamp.
 * Each continuous breach event produces one document. A beyond-24h gap
 * produces a new document (different alert-started-timestamp).
 * The collection should have a unique index on
 * `{ samplingPointId: 1, 'alert-started-timestamp': 1 }`.
 */
function buildNewEventStateQuery(member) {
  return {
    samplingPointId: member.samplingPointId,
    'alert-started-timestamp': member.date
  }
}

/**
 * MongoDB query shape for updating an EXISTING event row.
 * Uses the alert-started-timestamp from the existing state row so the
 * update targets the correct document for the current event window.
 */
function buildExistingEventStateQuery(samplingPointId, alertStartedTimestamp) {
  return {
    samplingPointId,
    'alert-started-timestamp': alertStartedTimestamp
  }
}

/**
 * Returns the Notify-template `daqi-level` value for a DAQI numeric reading.
 *   DAQI 7–9  → 'high'
 *   DAQI ≥ 10 → 'very high'
 * Values below 7 should never reach here (they're filtered out upstream).
 */
function getDaqiLabel(daqiValue) {
  return daqiValue >= DAQI_VERY_HIGH_THRESHOLD ? 'very high' : 'high'
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
        item.date &&
        isWithinLast24Hours(item.date)
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

/**
 * Bulk-loads the most recent state row per samplingPointId for all candidates.
 * Sorted by alert-started-timestamp descending so that when multiple event
 * rows exist for the same samplingPointId (each beyond-24h gap creates a new
 * row), the first map.set wins — giving us the latest event row for each id.
 * @returns {Promise<Map<number, object>>}
 */
async function loadRecentStateRowsBySamplingPointId(db, candidates) {
  if (candidates.length === 0) {
    return new Map()
  }
  const samplingPointIds = candidates.map((c) => c.samplingPointId)
  const rows = await db
    .collection(DAQI_ALERT_STATUS_COLLECTION)
    .find({ samplingPointId: { $in: samplingPointIds } })
    .sort({ 'alert-started-timestamp': -1 })
    .toArray()
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row.samplingPointId)) {
      map.set(row.samplingPointId, row)
    }
  }
  return map
}

async function markAlertInProgress(db, alertDetail) {
  // New event row: compound key (samplingPointId + alert-started-timestamp).
  // Beyond-24h gap → different alert-started-timestamp → new document inserted.
  // Within-24h repeat → same compound key → existing document updated.
  await db.collection(DAQI_ALERT_STATUS_COLLECTION).updateOne(
    buildNewEventStateQuery(alertDetail),
    {
      $set: {
        samplingPointId: alertDetail.samplingPointId,
        siteId: alertDetail.siteId,
        pollutant: cleanPollutantName(alertDetail.pollutant),
        daqi: alertDetail.daqi,
        region: alertDetail.region,
        lastUpdatedFromRicardo: alertDetail.date,
        'process-status': 'in-progress',
        'alert-started-timestamp': alertDetail.date
      }
    },
    { upsert: true }
  )
}

async function markAlertProcessed(db, alertDetail) {
  await db
    .collection(DAQI_ALERT_STATUS_COLLECTION)
    .updateOne(buildNewEventStateQuery(alertDetail), {
      $set: {
        'process-status': 'processed'
      }
    })
}

/**
 * Bumps `lastUpdatedFromRicardo` (and last-seen `daqi`) for a combo whose
 * users were already notified within the 24h window. No notification is sent
 * and no audit row is written — the row is just kept current for traceability.
 * Uses the existing row's alert-started-timestamp to target the correct
 * event document — not the incoming alert date.
 */
async function updateStateForExistingAlert(db, alertDetail, existingRow) {
  await db
    .collection(DAQI_ALERT_STATUS_COLLECTION)
    .updateOne(
      buildExistingEventStateQuery(
        alertDetail.samplingPointId,
        existingRow['alert-started-timestamp']
      ),
      {
        $set: {
          lastUpdatedFromRicardo: alertDetail.date,
          daqi: alertDetail.daqi
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
      'daqi-level': getDaqiLabel(alertDetail.daqi),
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

    const allSent = await sendNotificationsToUsers({
      db,
      alertDetail: resolvedDetail,
      matchedUsers,
      logPrefix: '[DAQI]',
      insertAuditEntry: insertDaqiAuditEntry,
      updateAuditEntry: updateDaqiAuditEntry,
      sendAlert: sendAlertToUser
    })

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

/**
 * Classifies one alert against its (optional) existing state row.
 *
 * Business rule: the 24h dedup window is anchored to `lastUpdatedFromRicardo`
 * (server time of when WE last processed this combo). As long as we keep
 * seeing this samplingPointId in Ricardo's response at least every 24h, we
 * treat it as one continuous event and don't re-notify. If Ricardo goes quiet
 * for >24h and the breach then reappears, that's a fresh event → notify again.
 *
 *   'skip-stuck'  — a prior cycle marked the combo in-progress and never
 *                   finished (mongo-lock guarantees serial cycles, so seeing
 *                   'in-progress' at cycle start means the prior cycle
 *                   crashed).
 *   'update-only' — the combo was last seen by Ricardo within 24h; bump
 *                   lastUpdatedFromRicardo, do not re-notify.
 *   'new'         — no row, OR Ricardo hasn't confirmed this combo for >24h.
 */
function classifyAlert(existingRow, now) {
  if (!existingRow) {
    return 'new'
  }
  if (existingRow['process-status'] === 'in-progress') {
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

export async function processDaqiAlerts(db) {
  logger.info('[DAQI] Starting DAQI alert processing cycle')

  const alertData = await fetchDaqiAlertsForCycle()
  if (!alertData) {
    return
  }

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
  if (validAlerts.length === 0) {
    return
  }

  // Collapse rows in this response that share the same samplingPointId but
  // differ in date — Ricardo can emit several refresh-readings of the same
  // breach in one response.
  const uniqueCandidates = collapseInCycleDuplicates(
    validAlerts,
    (a) => a.samplingPointId
  )
  logger.info(
    `[DAQI] ${uniqueCandidates.length} unique candidate alerts (${validAlerts.length - uniqueCandidates.length} in-cycle duplicates collapsed by samplingPointId)`
  )

  if (!(await ensureCacheReadyForCycle('[DAQI]'))) {
    return
  }

  // One bulk read for all candidate samplingPointIds, then classify each.
  const stateBySamplingPointId = await loadRecentStateRowsBySamplingPointId(
    db,
    uniqueCandidates
  )
  const now = Date.now()
  const counts = { new: 0, 'update-only': 0, 'skip-stuck': 0 }

  for (const alertDetail of uniqueCandidates) {
    const existing = stateBySamplingPointId.get(alertDetail.samplingPointId)
    const verdict = classifyAlert(existing, now)
    counts[verdict]++

    if (verdict === 'skip-stuck') {
      logger.info(
        `[DAQI] Skipping samplingPointId ${alertDetail.samplingPointId}: prior cycle left it in-progress (likely crashed mid-process — manual review needed)`
      )
      continue
    }

    if (verdict === 'update-only') {
      await updateStateForExistingAlert(db, alertDetail, existing)
      logger.info(
        `[DAQI] Update-only for samplingPointId ${alertDetail.samplingPointId} (last Ricardo reading at ${existing.lastUpdatedFromRicardo}, within 24h)`
      )
      continue
    }

    // verdict === 'new'
    await processAlertForUsers(db, alertDetail)
  }

  logger.info(
    `[DAQI] Cycle summary ${JSON.stringify({
      candidates: uniqueCandidates.length,
      new: counts.new,
      updateOnly: counts['update-only'],
      skipStuck: counts['skip-stuck']
    })}`
  )
  logger.info('[DAQI] DAQI alert processing cycle completed')
}

export {
  filterValidDaqiAlerts,
  getMatchingUsers,
  markAlertInProgress,
  markAlertProcessed,
  sendAlertToUser,
  buildAlertKey,
  classifyAlert
}
