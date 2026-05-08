import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point, polygon } from '@turf/helpers'
import bbox from '@turf/bbox'
import centroid from '@turf/centroid'
import distance from '@turf/distance'
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

function bboxPolygon(feature) {
  const [minX, minY, maxX, maxY] = bbox(feature)
  return polygon([
    [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY]
    ]
  ])
}

const england = loadGeoJSON('../../GeoBoundaries/england.geojson')
const northernIreland = loadGeoJSON(
  '../../GeoBoundaries/northernireland.geojson'
)
const wales = loadGeoJSON('../../GeoBoundaries/wales.geojson')
const scotland = loadGeoJSON('../../GeoBoundaries/scotland.geojson')

// module-level variable, loaded once — bboxPoly and centroidPt pre-computed
const regions = [
  ...extractRegions(england),
  ...extractRegions(northernIreland),
  ...extractRegions(wales),
  ...extractRegions(scotland)
].map((r) => ({
  ...r,
  bboxPoly: bboxPolygon(r.feature),
  centroidPt: centroid(r.feature)
}))

/**
 * reads from the already-in-memory `regions` array
 * Returns the UK region name for a given lat/long using a 3-step fallback:
 *   1. Direct point-in-polygon  (land points)
 *   2. Bounding-box check       (inland water bodies / near-coast)
 *   3. Nearest centroid         (offshore / sea — MetOffice 12 km² grid can fall outside land boundaries)
 * @param {number} lat - Latitude
 * @param {number} long - Longitude
 * @returns {string} - Region name or 'Unknown'
 */
export function findRegion(lat, long) {
  try {
    const pt = point([long, lat])

    // 1 — direct point-in-polygon (land points)
    const direct = regions.find((r) => booleanPointInPolygon(pt, r.feature))
    if (direct) {
      return direct.name
    }

    // 2 — bounding-box fallback (inland water bodies / near-coast points)
    const bboxMatch = regions.find((r) => booleanPointInPolygon(pt, r.bboxPoly))
    if (bboxMatch) {
      return bboxMatch.name
    }

    // 3 — nearest centroid fallback (offshore / sea points)
    let nearest = null
    let nearestDist = Infinity
    for (const r of regions) {
      const d = distance(pt, r.centroidPt)
      if (d < nearestDist) {
        nearestDist = d
        nearest = r
      }
    }
    if (nearest) {
      logger.info(
        `[RegionFinder] Nearest-centroid fallback matched ${JSON.stringify({ lat, long, region: nearest.name, distanceKm: nearestDist.toFixed(1) })}`
      )
      return nearest.name
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
