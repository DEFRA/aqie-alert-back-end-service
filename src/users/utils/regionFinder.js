import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { createLogger } from '../../common/helpers/logging/logger.js'

const currentFilePath = fileURLToPath(import.meta.url)
const currentDirPath = dirname(currentFilePath)
const logger = createLogger()

//  Load GeoJSON files using readFileSync + JSON.parse (works correctly with ES Modules)
const loadGeoJSON = (filePath) => {
  try {
    return JSON.parse(readFileSync(join(currentDirPath, filePath), 'utf-8'))
  } catch (err) {
    logger.error(`Failed to load GeoJSON file: ${filePath} - ${err.message}`)
    return null
  }
}

const englandBoundary = loadGeoJSON('../../GeoBoundaries/england.geojson')
const walesBoundary = loadGeoJSON('../../GeoBoundaries/wales.geojson')
const scotlandBoundary = loadGeoJSON('../../GeoBoundaries/scotland.geojson')
const northernIrelandBoundary = loadGeoJSON(
  '../../GeoBoundaries/northern_ireland.geojson'
)

const regions = [
  { name: 'England', boundary: englandBoundary },
  { name: 'Wales', boundary: walesBoundary },
  { name: 'Scotland', boundary: scotlandBoundary },
  { name: 'Northern Ireland', boundary: northernIrelandBoundary }
].filter((r) => r.boundary !== null) //  Skip any failed GeoJSON loads

/**
 * Returns true if the given point falls within any feature of the boundary.
 * Supports both FeatureCollection and single Feature GeoJSON structures.
 */
function isPointInBoundary(pt, boundary) {
  const features =
    boundary.type === 'FeatureCollection' ? boundary.features : [boundary]
  return features.some((feature) => booleanPointInPolygon(pt, feature))
}

/**
 * Finds the region (England, Wales, Scotland, Northern Ireland) for a given lat/long.
 * @param {number} lat - Latitude
 * @param {number} long - Longitude
 * @returns {string} - Region name or 'Unknown'
 */
export function findRegion(lat, long) {
  try {
    const pt = point([long, lat]) // GeoJSON format: [longitude, latitude]
    const matched = regions.find((region) =>
      isPointInBoundary(pt, region.boundary)
    )
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
