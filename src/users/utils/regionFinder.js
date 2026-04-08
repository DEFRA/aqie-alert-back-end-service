import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { createLogger } from '../../common/helpers/logging/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const logger = createLogger()

//  Load GeoJSON files using readFileSync + JSON.parse (works correctly with ES Modules)
const loadGeoJSON = (filePath) => {
  try {
    return JSON.parse(readFileSync(join(__dirname, filePath), 'utf-8'))
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
 * Finds the region (England, Wales, Scotland, Northern Ireland) for a given lat/long.
 * @param {number} lat - Latitude
 * @param {number} long - Longitude
 * @returns {string} - Region name or 'Unknown'
 */
export function findRegion(lat, long) {
  try {
    const pt = point([long, lat]) // GeoJSON format: [longitude, latitude]

    for (const region of regions) {
      const boundary = region.boundary

      // Support both FeatureCollection and Feature GeoJSON structures
      const features =
        boundary.type === 'FeatureCollection' ? boundary.features : [boundary]

      for (const feature of features) {
        if (booleanPointInPolygon(pt, feature)) {
          return region.name
        }
      }
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
