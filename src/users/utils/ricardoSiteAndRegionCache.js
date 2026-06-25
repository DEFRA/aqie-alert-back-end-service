import { fetchSiteMetaData } from './ricardoApiClient.js'
import { findRegion } from './regionFinder.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()
// Reassigned wholesale on each successful refresh (atomic swap). All accessors
// read the live binding, so swapping the reference updates them consistently.
let siteRegionMap = new Map()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Bounded retry-with-backoff applied to the startup population only (so a
// transient Ricardo blip at boot doesn't leave the cache empty until the first
// request/cron triggers an on-demand refresh). Defaults are used by
// initSiteCache(); tests override them via initSiteCache({ maxAttempts, baseDelayMs }).
const BOOT_MAX_ATTEMPTS = 3
const BOOT_BASE_DELAY_MS = 1000

// Unique, stable marker for log-based alerting (e.g. a Slack alert rule that
// matches this exact token). Emitted whenever the site-region cache is confirmed
// empty — DAQI/AQSR region resolution and the alert crons are degraded until it
// repopulates.
const EMPTY_CACHE_ALERT = '[SiteCache][ALERT] SITE_CACHE_EMPTY'

let lastRefreshedAt = null
let refreshInterval = null

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Emits the unique alert marker only when the cache is actually empty, so a
// failed refresh that preserved a previously-good cache does NOT alert.
function alertIfCacheEmpty(phase) {
  if (siteRegionMap.size === 0) {
    logger.error(
      `${EMPTY_CACHE_ALERT} site-region cache is empty after ${phase}; region resolution is degraded until it repopulates ${JSON.stringify({ phase })}`
    )
  }
}

// Maps a single Ricardo site row to a cache entry. Returns null when the row
// can't be used (missing fields, or coordinates outside known UK regions).
function mapSiteToCacheEntry({ siteId, latitude, longitude, siteName }) {
  if (!siteId || latitude == null || longitude == null) {
    return null
  }
  const region = findRegion(
    Number.parseFloat(latitude),
    Number.parseFloat(longitude)
  )
  if (region === 'Unknown') {
    logger.warn(
      `[SiteCache] Could not determine region for site ${JSON.stringify({ siteId, latitude, longitude })}`
    )
    return null
  }
  return { region, monitoringStationName: siteName ?? null }
}

async function fetchSiteMetaDataForRefresh() {
  try {
    return await fetchSiteMetaData()
  } catch (err) {
    logger.error(
      `[SiteCache] Failed to fetch site metadata ${JSON.stringify({ upstreamStatus: err.status ?? null, error: err.message })}`
    )
    return null
  }
}

async function refreshCache() {
  const siteData = await fetchSiteMetaDataForRefresh()
  if (!siteData) return

  const members = siteData.member ?? []
  if (members.length === 0) {
    // Keep the existing cache rather than wiping it on a thin response.
    logger.info('[SiteCache] No sites returned from site metadata API')
    return
  }

  // Build into a fresh map and swap it in atomically below, so sites that
  // Ricardo has removed/re-classified are dropped (no stale entries) and
  // readers never observe a half-populated cache mid-refresh.
  const nextMap = new Map()
  let populated = 0
  let skipped = 0

  for (const member of members) {
    const entry = mapSiteToCacheEntry(member)
    if (entry) {
      nextMap.set(member.siteId, entry)
      populated++
    } else {
      skipped++
    }
  }

  if (populated === 0) {
    // A response with members but zero usable sites usually means bad/garbled
    // upstream data — keep the previous good cache instead of swapping in empty.
    logger.warn(
      `[SiteCache] Refresh produced no usable sites; keeping existing cache ${JSON.stringify({ total: members.length, skipped })}`
    )
    return
  }

  siteRegionMap = nextMap
  lastRefreshedAt = new Date()
  logger.info(
    `[SiteCache] Site-region map rebuilt ${JSON.stringify({ total: members.length, populated, skipped, lastRefreshedAt })}`
  )
}

// Startup-only: retry the refresh with exponential backoff until the cache has
// at least one site or attempts are exhausted. Used by initSiteCache only;
// refreshCache itself (used by the TTL interval and on-demand path) is unchanged.
async function refreshCacheWithRetry(maxAttempts, baseDelayMs) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await refreshCache()
    if (siteRegionMap.size > 0) {
      return
    }
    if (attempt < maxAttempts) {
      const backoff = baseDelayMs * 2 ** (attempt - 1)
      logger.warn(
        `[SiteCache] Cache still empty after startup attempt ${attempt}/${maxAttempts}; retrying in ${backoff}ms`
      )
      if (backoff > 0) {
        await delay(backoff)
      }
    }
  }
}

export async function initSiteCache({
  maxAttempts = BOOT_MAX_ATTEMPTS,
  baseDelayMs = BOOT_BASE_DELAY_MS
} = {}) {
  logger.info('[SiteCache] Populating site-region map from Ricardo API')
  await refreshCacheWithRetry(maxAttempts, baseDelayMs)
  alertIfCacheEmpty('startup')

  refreshInterval = setInterval(async () => {
    logger.info('[SiteCache] TTL reached (24h) — refreshing site-region map')
    await refreshCache()
    alertIfCacheEmpty('scheduled-refresh')
  }, CACHE_TTL_MS)
}

export function stopSiteCache() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
    logger.info('[SiteCache] Stopped site-region cache refresh interval')
  }
}

export function getRegionForSite(siteId) {
  return siteRegionMap.get(siteId)?.region ?? null
}

export function getSiteIdsForRegion(region) {
  const siteIds = []
  for (const [siteId, siteInfo] of siteRegionMap) {
    if (siteInfo.region === region) {
      siteIds.push(siteId)
    }
  }
  return siteIds
}

export function getSiteInfo(siteId) {
  return siteRegionMap.get(siteId) ?? null
}

export function getSiteCacheSize() {
  return siteRegionMap.size
}

/**
 * On-demand health check for the site-region cache.
 *
 * The cache is normally populated at startup and refreshed every 24h, but if
 * the startup fetch failed the map can be empty — which would make every
 * region lookup return nothing and silently mask the outage. When the cache is
 * empty this attempts a single re-fetch so callers can tell "cache unhealthy"
 * apart from "region legitimately has no sites".
 *
 * @returns {Promise<boolean>} true if the cache holds at least one site afterwards.
 */
export async function ensureSiteCachePopulated() {
  if (siteRegionMap.size > 0) {
    return true
  }
  logger.warn(
    '[SiteCache] Cache empty — attempting on-demand refresh before serving request'
  )
  await refreshCache()
  alertIfCacheEmpty('on-demand-refresh')
  return siteRegionMap.size > 0
}
