import { findRegion } from './regionFinder.js'
import {
  getSiteCacheSize,
  ensureSiteCachePopulated
} from './ricardoSiteAndRegionCache.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Resolves the UK region for the supplied coordinates and ensures the site
 * cache is healthy enough for per-siteId region lookups.
 *
 * Region is always derived from siteId via the cache (never Ricardo's coarse
 * region field), so callers filter alerts with
 * `getRegionForSite(alert.siteId) === region`.
 *
 * @param {number} lat
 * @param {number} long
 * @param {{ logPrefix: string, requestId: string }} ctx - for correlated logging
 * @returns {Promise<{ region: string } | null>} the resolved region, or null
 *   when the caller should respond with an empty result — either the
 *   coordinates are outside known UK regions, or the site cache is empty and
 *   could not be repopulated (so region lookups would be unreliable and we
 *   should not mask the outage as "no alerts").
 */
export async function resolveRegionContext(
  lat,
  long,
  { logPrefix, requestId }
) {
  const region = findRegion(lat, long)
  logger.info(
    `${logPrefix} Region resolved ${JSON.stringify({ requestId, lat, long, region })}`
  )

  if (region === 'Unknown') {
    logger.info(
      `${logPrefix} Coordinates outside known UK regions ${JSON.stringify({ requestId, lat, long })}`
    )
    return null
  }

  // Per-siteId region lookups depend on the site cache. If it's globally empty
  // the startup fetch likely failed — try one on-demand refresh, and give up
  // with an empty result if it still can't be populated.
  if (getSiteCacheSize() === 0) {
    const populated = await ensureSiteCachePopulated()
    if (!populated) {
      logger.info(
        `${logPrefix} Site cache empty and refresh failed; returning empty result ${JSON.stringify({ requestId, region })}`
      )
      return null
    }
  }

  return { region }
}
