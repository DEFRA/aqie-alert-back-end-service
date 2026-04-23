import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

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

// Region order across four files (18 total):
// England (0-8):        North East, North West, Yorkshire & The Humber, East Midlands,
//                       West Midlands, Eastern, Greater London, South East, South West
// NorthernIreland (9):  Northern Ireland
// Wales (10-12):        North Wales, Mid and South West Wales, South East Wales
// Scotland (13-17):     East Central Scotland, Highlands and Islands, West Central Scotland,
//                       North Eastern Scotland, Southern Scotland

describe('regionFinder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPoint.mockImplementation((coords) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords }
    }))
  })

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

    const result = findRegion(51.5074, -0.1278)

    expect(result).toBe('Greater London')
    expect(mockPoint).toHaveBeenCalledWith([-0.1278, 51.5074])
  })

  it('should return North East for Newcastle coordinates', () => {
    mockBooleanPointInPolygon.mockReturnValueOnce(true)

    const result = findRegion(54.9783, -1.6178)

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

    const result = findRegion(54.5973, -5.9301)

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

    const result = findRegion(55.9533, -3.1883)

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

    const result = findRegion(51.4816, -3.1791)

    expect(result).toBe('South East Wales')
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
