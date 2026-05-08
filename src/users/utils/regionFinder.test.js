import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const mockPoint = vi.fn()
const mockPolygon = vi.fn((coords) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: coords }
}))
const mockBooleanPointInPolygon = vi.fn()
const mockBbox = vi.fn().mockReturnValue([0, 0, 1, 1])
const mockCentroid = vi.fn().mockReturnValue({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0.5, 0.5] }
})
const mockDistance = vi.fn()

vi.mock('@turf/helpers', () => ({
  point: mockPoint,
  polygon: mockPolygon
}))

vi.mock('@turf/boolean-point-in-polygon', () => ({
  default: mockBooleanPointInPolygon
}))

vi.mock('@turf/bbox', () => ({
  default: mockBbox
}))

vi.mock('@turf/centroid', () => ({
  default: mockCentroid
}))

vi.mock('@turf/distance', () => ({
  default: mockDistance
}))

// Import after mocks are set up
const { findRegion } = await import('./regionFinder.js')

// Region order across four files (18 total):
// England (0-8):        North East, North West, Yorkshire & The Humber, East Midlands,
//                       West Midlands, Eastern, Greater London, South East, South West
// NorthernIreland (9):  Northern Ireland
// Wales (10-12):        North Wales, Mid and South West Wales, South East Wales
// Scotland (13-17):     East Central Scotland, Highlands and Islands, West Central Scotland,
//                       North Eastern Scotland, Southern Scotland
const REGION_COUNT = 18

const LONDON = { lat: 51.5074, lng: -0.1278 }
const NEWCASTLE = { lat: 54.9783, lng: -1.6178 }
const BELFAST = { lat: 54.5973, lng: -5.9301 }
const EDINBURGH = { lat: 55.9533, lng: -3.1883 }
const CARDIFF = { lat: 51.4816, lng: -3.1791 }
const NEAR_NORTH_SEA = { lat: 55.0, lng: -1.5 }
const OFFSHORE_NORTH_SEA = { lat: 55.0, lng: 2.0 }

describe('regionFinder', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockPoint.mockImplementation((coords) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords }
    }))
  })

  describe('direct point-in-polygon matches', () => {
    it('should return Greater London for London coordinates', () => {
      // Greater London is index 6 — false for 0-5, true on 6
      mockBooleanPointInPolygon
        .mockReturnValueOnce(false) // North East
        .mockReturnValueOnce(false) // North West
        .mockReturnValueOnce(false) // Yorkshire & The Humber
        .mockReturnValueOnce(false) // East Midlands
        .mockReturnValueOnce(false) // West Midlands
        .mockReturnValueOnce(false) // Eastern
        .mockReturnValueOnce(true) // Greater London

      const result = findRegion(LONDON.lat, LONDON.lng)

      expect(result).toBe('Greater London')
      expect(mockPoint).toHaveBeenCalledWith([LONDON.lng, LONDON.lat])
    })

    it('should return North East for Newcastle coordinates', () => {
      mockBooleanPointInPolygon.mockReturnValueOnce(true)

      const result = findRegion(NEWCASTLE.lat, NEWCASTLE.lng)

      expect(result).toBe('North East')
    })

    it('should return Northern Ireland for Belfast coordinates', () => {
      // Northern Ireland is index 9 — false for 0-8, true on 9
      mockBooleanPointInPolygon
        .mockReturnValueOnce(false) // North East
        .mockReturnValueOnce(false) // North West
        .mockReturnValueOnce(false) // Yorkshire & The Humber
        .mockReturnValueOnce(false) // East Midlands
        .mockReturnValueOnce(false) // West Midlands
        .mockReturnValueOnce(false) // Eastern
        .mockReturnValueOnce(false) // Greater London
        .mockReturnValueOnce(false) // South East
        .mockReturnValueOnce(false) // South West
        .mockReturnValueOnce(true) // Northern Ireland

      const result = findRegion(BELFAST.lat, BELFAST.lng)

      expect(result).toBe('Northern Ireland')
    })

    it('should return East Central Scotland for Edinburgh coordinates', () => {
      // East Central Scotland is index 13 — false for 0-12, true on 13
      mockBooleanPointInPolygon
        .mockReturnValueOnce(false) // 0 North East
        .mockReturnValueOnce(false) // 1 North West
        .mockReturnValueOnce(false) // 2 Yorkshire & The Humber
        .mockReturnValueOnce(false) // 3 East Midlands
        .mockReturnValueOnce(false) // 4 West Midlands
        .mockReturnValueOnce(false) // 5 Eastern
        .mockReturnValueOnce(false) // 6 Greater London
        .mockReturnValueOnce(false) // 7 South East
        .mockReturnValueOnce(false) // 8 South West
        .mockReturnValueOnce(false) // 9 Northern Ireland
        .mockReturnValueOnce(false) // 10 North Wales
        .mockReturnValueOnce(false) // 11 Mid and South West Wales
        .mockReturnValueOnce(false) // 12 South East Wales
        .mockReturnValueOnce(true) // 13 East Central Scotland

      const result = findRegion(EDINBURGH.lat, EDINBURGH.lng)

      expect(result).toBe('East Central Scotland')
    })

    it('should return South East Wales for Cardiff coordinates', () => {
      // South East Wales is index 12 — false for 0-11, true on 12
      mockBooleanPointInPolygon
        .mockReturnValueOnce(false) // 0-9 all EnglandNI
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false) // 10 North Wales
        .mockReturnValueOnce(false) // 11 Mid and South West Wales
        .mockReturnValueOnce(true) // 12 South East Wales

      const result = findRegion(CARDIFF.lat, CARDIFF.lng)

      expect(result).toBe('South East Wales')
    })
  })

  describe('fallback matches', () => {
    it('should return region via bounding-box fallback for a water-body point', () => {
      // step 1: all REGION_COUNT direct PIP checks fail
      // step 2: first bbox check (North East) matches on call REGION_COUNT + 1
      let callCount = 0
      mockBooleanPointInPolygon.mockImplementation(() => {
        callCount++
        return callCount === REGION_COUNT + 1
      })

      const result = findRegion(NEAR_NORTH_SEA.lat, NEAR_NORTH_SEA.lng)

      expect(result).toBe('North East')
    })

    it('should return nearest region via centroid fallback for an offshore point', () => {
      // all PIP checks fail (step 1 + step 2 = 2 × REGION_COUNT calls)
      mockBooleanPointInPolygon.mockReturnValue(false)
      // North East (first region, first distance call) wins at 50 km vs 500 km for the rest
      const NEAR_KM = 50
      const FAR_KM = 500
      mockDistance.mockReturnValueOnce(NEAR_KM).mockReturnValue(FAR_KM)

      const result = findRegion(OFFSHORE_NORTH_SEA.lat, OFFSHORE_NORTH_SEA.lng)

      expect(result).toBe('North East')
    })
  })

  describe('error handling', () => {
    it('should return Unknown when an error is thrown', () => {
      mockBooleanPointInPolygon.mockImplementation(() => {
        throw new Error('Turf error')
      })

      const result = findRegion(LONDON.lat, LONDON.lng)

      expect(result).toBe('Unknown')
    })
  })
})
