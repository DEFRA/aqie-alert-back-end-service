import { fetchSiteMetaData } from './ricardoApiClient.js'
import { findRegion } from './regionFinder.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()
const siteRegionMap = new Map()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

let lastRefreshedAt = null
let refreshInterval = null

async function refreshCache() {
  let siteData
  try {
    siteData = await fetchSiteMetaData()
  } catch (err) {
    logger.error(
      `[SiteCache] Failed to fetch site metadata ${JSON.stringify({ error: err.message })}`
    )
    return
  }

  const members = siteData.member ?? []
  if (members.length === 0) {
    logger.info('[SiteCache] No sites returned from site metadata API')
    return
  }

  let populated = 0
  let skipped = 0

  for (const { siteId, latitude, longitude } of members) {
    if (!siteId || latitude == null || longitude == null) {
      skipped++
    } else {
      const region = findRegion(
        Number.parseFloat(latitude),
        Number.parseFloat(longitude)
      )
      if (region === 'Unknown') {
        logger.warn(
          `[SiteCache] Could not determine region for site ${JSON.stringify({ siteId, latitude, longitude })}`
        )
        skipped++
      } else {
        siteRegionMap.set(siteId, region)
        populated++
      }
    }
  }

  lastRefreshedAt = new Date()
  logger.info(
    `[SiteCache] Site-region map populated ${JSON.stringify({ total: members.length, populated, skipped, lastRefreshedAt })}`
  )
}

export async function initSiteCache() {
  logger.info('[SiteCache] Populating site-region map from Ricardo API')
  await refreshCache()

  refreshInterval = setInterval(async () => {
    logger.info('[SiteCache] TTL reached (24h) — refreshing site-region map')
    await refreshCache()
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
  return siteRegionMap.get(siteId) ?? null
}
