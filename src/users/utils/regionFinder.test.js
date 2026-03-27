import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

// Mock the GeoJSON boundary files
vi.mock('../../GeoBoundaries/england.geojson', () => ({
  default: {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: {} }]
  }
}))
vi.mock('../../GeoBoundaries/wales.geojson', () => ({
  default: {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: {} }]
  }
}))
vi.mock('../../GeoBoundaries/scotland.geojson', () => ({
  default: {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: {} }]
  }
}))
vi.mock('../../GeoBoundaries/northern-ireland.geojson', () => ({
  default: {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: {} }]
  }
}))

// Mock @turf/helpers and @turf/boolean-point-in-polygon
const mockPoint = vi.fn((coords) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: coords }
}))
const mockBooleanPointInPolygon = vi.fn()

vi.mock('@turf/helpers', () => ({
  point: mockPoint
}))

vi.mock('@turf/boolean-point-in-polygon', () => ({
  default: mockBooleanPointInPolygon
}))

// Import after mocks are set up
const { findRegion } = await import('./regionFinder.js')

describe('regionFinder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPoint.mockImplementation((coords) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords }
    }))
  })

  it('should return England for London coordinates', () => {
    // England is first in the regions array - return true for it
    mockBooleanPointInPolygon.mockReturnValueOnce(true)

    const result = findRegion(51.5074, -0.1278)

    expect(result).toBe('England')
    expect(mockPoint).toHaveBeenCalledWith([-0.1278, 51.5074])
  })

  it('should return Wales for Cardiff coordinates', () => {
    // England check returns false, Wales returns true
    mockBooleanPointInPolygon
      .mockReturnValueOnce(false) // England
      .mockReturnValueOnce(true) // Wales

    const result = findRegion(51.4816, -3.1791)

    expect(result).toBe('Wales')
  })

  it('should return Scotland for Edinburgh coordinates', () => {
    // England and Wales return false, Scotland returns true
    mockBooleanPointInPolygon
      .mockReturnValueOnce(false) // England
      .mockReturnValueOnce(false) // Wales
      .mockReturnValueOnce(true) // Scotland

    const result = findRegion(55.9533, -3.1883)

    expect(result).toBe('Scotland')
  })

  it('should return Northern Ireland for Belfast coordinates', () => {
    // England, Wales, Scotland return false, Northern Ireland returns true
    mockBooleanPointInPolygon
      .mockReturnValueOnce(false) // England
      .mockReturnValueOnce(false) // Wales
      .mockReturnValueOnce(false) // Scotland
      .mockReturnValueOnce(true) // Northern Ireland

    const result = findRegion(54.5973, -5.9301)

    expect(result).toBe('Northern Ireland')
  })

  it('should return Unknown when coordinates do not match any region', () => {
    mockBooleanPointInPolygon.mockReturnValue(false)

    const result = findRegion(0, 0)

    expect(result).toBe('Unknown')
  })

  it('should return Unknown when an error is thrown', () => {
    mockBooleanPointInPolygon.mockImplementation(() => {
      throw new Error('Turf error')
    })

    const result = findRegion(51.5074, -0.1278)

    expect(result).toBe('Unknown')
  })
})
