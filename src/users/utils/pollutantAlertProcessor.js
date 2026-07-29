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

function isAlertOrInformationLevel(item) {
  return item.alertLevel === true || item.informationLevel === true
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
        isAlertOrInformationLevel(item) &&
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
 * Builds a map of samplingPointId → { date, concentration } for the NEWEST
 * reading from the full (pre-dedup) valid alert list.
 *
 * `deduplicateAlertsOldestFirst` keeps the OLDEST reading per samplingPointId
 * so that `alert-started-timestamp` reflects when the breach first occurred.
 * However that means the NEWER readings (updated concentrations / timestamps
 * from the same breach event) are discarded.
 *
 * We capture the latest date AND concentration here — separately — so that
 * `lastUpdatedFromRicardo` and the stored `concentration` always reflect
 * Ricardo's most recent measurement, not the breach-start reading.
 *
 * Example: Ricardo returns samplingPointId 2211 at 08:00 (189 µg/m³) and
 *          15:00 (199 µg/m³):
 *   alert-started-timestamp  = 08:00  (oldest — breach start)
 *   lastUpdatedFromRicardo   = 15:00  (newest — latest confirmation)
 *   concentration (state)    = 199    (newest — current severity)
 *
 * @param {object[]} alerts - The already-filtered valid alert list (pre-dedup)
 * @returns {Map<number, {date: string, concentration: number}>}
 */
export function buildLatestReadingMap(alerts) {
  const map = new Map()
  for (const alert of alerts) {
    const existing = map.get(alert.samplingPointId)
    if (!existing || new Date(alert.date) > new Date(existing.date)) {
      map.set(alert.samplingPointId, {
        date: alert.date,
        concentration: alert.concentration
      })
    }
  }
  return map
}

/**
 * Normalises a timestamp that may be stored as an ISO string (runtime writes)
 * or a BSON Date (legacy `addAlertStartedTimestampToState` migration writes)
 * to epoch milliseconds. Missing/invalid values return 0 so they sort oldest.
 */
function toEpochMs(value) {
  if (!value) {
    return 0
  }
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Bulk-loads the most recent state row per samplingPointId (stored under
 * `alert-id`) for all candidates, so that when multiple event rows exist for
 * the same samplingPointId (each beyond-24h gap creates a new row) we classify
 * against the latest one.
 *
 * Selection is done in JS by the chronological value of
 * `alert-started-timestamp`, NOT via a MongoDB `.sort()`. The
 * `addAlertStartedTimestampToState` migration stores this field as a BSON Date,
 * while the runtime writes it as an ISO string. MongoDB's cross-type sort orders
 * every Date AFTER every String, so `.sort({ 'alert-started-timestamp': -1 })`
 * would surface a stale Date-typed legacy row as the "most recent" one; its
 * expired `lastUpdatedFromRicardo` then makes classifyAlert return 'new' every
 * cycle and re-notify users indefinitely. `toEpochMs` compares both shapes by
 * actual time.
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
    .toArray()
  const map = new Map()
  for (const row of rows) {
    const existing = map.get(row['alert-id'])
    if (
      !existing ||
      toEpochMs(row['alert-started-timestamp']) >
        toEpochMs(existing['alert-started-timestamp'])
    ) {
      map.set(row['alert-id'], row)
    }
  }
  return map
}

async function markAlertInProgress(db, alertDetail) {
  // New event row: compound key (alert-id + alert-started-timestamp).
  // Beyond-24h gap → different alert-started-timestamp → new document inserted.
  // Within-24h repeat → same compound key → existing document updated in-place.
  //
  // lastUpdatedFromRicardo is set to alertDetail.date (Ricardo's event timestamp),
  // matching the DAQI cron pattern. The 24h dedup window in classifyAlert compares
  // Date.now() against this value — as long as Ricardo keeps returning this
  // samplingPointId within a 24h rolling window, the breach is treated as one
  // continuous event and users are not re-notified.
  await db.collection(POLLUTANT_ALERT_STATUS_COLLECTION).updateOne(
    buildNewEventStateQuery(alertDetail),
    {
      $set: {
        'alert-id': alertDetail.samplingPointId,
        siteId: alertDetail.siteId,
        region: alertDetail.region,
        pollutant: alertDetail.pollutant,
        concentration:
          alertDetail.latestRicardoConcentration ?? alertDetail.concentration,
        alertThreshold: alertDetail.alertThreshold,
        lastUpdatedFromRicardo:
          alertDetail.latestRicardoDate ?? alertDetail.date,
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
 *
 * lastUpdatedFromRicardo is set to alertDetail.date (Ricardo's event timestamp),
 * matching the DAQI cron pattern, so the 24h dedup window stays anchored to
 * the breach event time reported by Ricardo.
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
          lastUpdatedFromRicardo:
            alertDetail.latestRicardoDate ?? alertDetail.date,
          concentration:
            alertDetail.latestRicardoConcentration ?? alertDetail.concentration
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
      // The {alert-id, user_contact, location} unique index already holds a row
      // for this recipient + alert-id: they were notified on an earlier cycle.
      // Return false so the caller skips the (duplicate) re-send.
      logger.warn(
        `[Pollutant] Duplicate audit entry skipped ${JSON.stringify({ 'alert-id': alertDetail['alert-id'], user_contact: userMatch.userContact, location: userMatch.location })}`
      )
      return false
    }
    throw err
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
  const lastUpdatedMs = toEpochMs(existingRow.lastUpdatedFromRicardo)
  if (now - lastUpdatedMs <= TWENTY_FOUR_HOURS_MS) {
    return 'update-only'
  }
  return 'new'
}

function enrichAlertWithLatestReading(
  alertDetail,
  latestReadingBySamplingPointId
) {
  const latestReading = latestReadingBySamplingPointId.get(
    alertDetail.samplingPointId
  )
  return {
    ...alertDetail,
    latestRicardoDate: latestReading?.date ?? alertDetail.date,
    latestRicardoConcentration:
      latestReading?.concentration ?? alertDetail.concentration
  }
}

async function dispatchAlert(db, enrichedDetail, existing, verdict) {
  if (verdict === 'skip-stuck') {
    logger.info(
      `[Pollutant] Skipping samplingPointId ${enrichedDetail.samplingPointId}: prior cycle left it in-progress (likely crashed mid-process — manual review needed)`
    )
  } else if (verdict === 'update-only') {
    await updateStateForExistingAlert(db, enrichedDetail, existing)
    logger.info(
      `[Pollutant] Update-only for samplingPointId ${enrichedDetail.samplingPointId} (last Ricardo reading at ${existing.lastUpdatedFromRicardo}, within 24h)`
    )
  } else {
    await processAlertForUsers(db, enrichedDetail)
  }
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

  // Before dedup: snapshot the LATEST (newest) Ricardo date and concentration
  // per samplingPointId. deduplicateAlertsOldestFirst keeps the oldest date as
  // the breach-start anchor, but lastUpdatedFromRicardo and the stored
  // concentration should reflect Ricardo's most recent measurement.
  const latestReadingBySamplingPointId = buildLatestReadingMap(validAlerts)

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
    // Attach the latest Ricardo date and concentration for this samplingPointId
    // so that markAlertInProgress / updateStateForExistingAlert store the most
    // recent reading's values rather than the (potentially older) dedup values.
    const enrichedDetail = enrichAlertWithLatestReading(
      alertDetail,
      latestReadingBySamplingPointId
    )
    const existing = stateByAlertId.get(alertDetail.samplingPointId)
    const verdict = classifyAlert(existing, now)
    counts[verdict]++
    await dispatchAlert(db, enrichedDetail, existing, verdict)
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
  buildAuditKey,
  loadRecentStateRowsByAlertId
}
