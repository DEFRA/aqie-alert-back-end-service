import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { createLogger } from '../../common/helpers/logging/logger.js'

const currentFilePath = fileURLToPath(import.meta.url)
const currentDirPath = dirname(currentFilePath)
const logger = createLogger()

const loadGeoJSON = (filePath) => {
  try {
    return JSON.parse(readFileSync(join(currentDirPath, filePath), 'utf-8'))
  } catch (err) {
    logger.error(`Failed to load GeoJSON file: ${filePath} - ${err.message}`)
    return null
  }
}

function extractRegions(geoJson) {
  if (!geoJson) {
    return []
  }
  return geoJson.features.map((feature) => ({
    name: feature.properties.ITL125NM ?? feature.properties.ITL225NM,
    feature
  }))
}

const england = loadGeoJSON('../../GeoBoundaries/England.GeoJSON')
const northernIreland = loadGeoJSON(
  '../../GeoBoundaries/NorthernIreland.GeoJSON'
)
const wales = loadGeoJSON('../../GeoBoundaries/Wales.GeoJSON')
const scotland = loadGeoJSON('../../GeoBoundaries/Scotland.GeoJSON')

// module-level variable, loaded once
const regions = [
  ...extractRegions(england),
  ...extractRegions(northernIreland),
  ...extractRegions(wales),
  ...extractRegions(scotland)
]

/**
 *
 * reads from the already-in-memory `regions` array
 * Returns the UK region name for a given lat/long.
 * Checks against 18 ITL1/ITL2 regions across EnglandNI and ScotlandWales boundaries.
 * @param {number} lat - Latitude
 * @param {number} long - Longitude
 * @returns {string} - Region name or 'Unknown'
 */
export function findRegion(lat, long) {
  try {
    const pt = point([long, lat])
    const matched = regions.find((r) => booleanPointInPolygon(pt, r.feature))
    if (matched) {
      return matched.name
    }
    logger.warn(
      `Region not found for coordinates ${JSON.stringify({ lat, long })}`
    )
    return 'Unknown'
  } catch (err) {
    logger.error(
      `Region finder error ${JSON.stringify({ err: err.message, lat, long })}`
    )
    return 'Unknown'
  }
}
