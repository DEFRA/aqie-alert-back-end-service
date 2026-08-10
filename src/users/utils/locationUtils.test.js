import { describe, it, expect } from 'vitest'
import {
  normalizeLocation,
  isSameLocation,
  formatLocationForUrl
} from './locationUtils.js'

describe('locationUtils', () => {
  describe('normalizeLocation', () => {
    it('should convert to lowercase', () => {
      expect(normalizeLocation('LONDON')).toBe('london')
      expect(normalizeLocation('London')).toBe('london')
    })

    it('should trim whitespace', () => {
      expect(normalizeLocation('  London  ')).toBe('london')
    })

    it('should normalize multiple spaces', () => {
      expect(normalizeLocation('London    Apprentice')).toBe(
        'london apprentice'
      )
    })

    it('should preserve full location context', () => {
      expect(normalizeLocation('London, City of Westminster')).toBe(
        'london, city of westminster'
      )
      expect(normalizeLocation('London Apprentice, Cornwall')).toBe(
        'london apprentice, cornwall'
      )
      expect(normalizeLocation('Little London, Buckinghamshire')).toBe(
        'little london, buckinghamshire'
      )
      expect(normalizeLocation('Little London, Leeds')).toBe(
        'little london, leeds'
      )
      expect(normalizeLocation('London Fields, Dudley')).toBe(
        'london fields, dudley'
      )
    })

    it('should handle complex location names', () => {
      expect(normalizeLocation('Staines-upon-thames, Spelthorne')).toBe(
        'staines-upon-thames, spelthorne'
      )
      expect(normalizeLocation('N8 7GE, Hornsey')).toBe('n8 7ge, hornsey')
    })

    it('should handle null/undefined', () => {
      expect(normalizeLocation(null)).toBeNull()
      expect(normalizeLocation(undefined)).toBeUndefined()
    })

    it('should handle non-string input', () => {
      expect(normalizeLocation(123)).toBe(123)
    })
  })

  describe('isSameLocation', () => {
    it('should detect same locations with different cases', () => {
      expect(isSameLocation('LONDON', 'london')).toBe(true)
      expect(isSameLocation('London', 'LONDON')).toBe(true)
    })

    it('should detect same locations with different spacing', () => {
      expect(isSameLocation('  London  ', 'london')).toBe(true)
      expect(isSameLocation('London    Apprentice', 'london apprentice')).toBe(
        true
      )
    })

    it('should treat different London locations as unique', () => {
      expect(
        isSameLocation(
          'London, City of Westminster',
          'London Apprentice, Cornwall'
        )
      ).toBe(false)
      expect(
        isSameLocation('Little London, Buckinghamshire', 'Little London, Leeds')
      ).toBe(false)
      expect(
        isSameLocation('Little London, Wiltshire', 'Little London, Walsall')
      ).toBe(false)
      expect(
        isSameLocation('London Fields, Dudley', 'London, City of Westminster')
      ).toBe(false)
    })

    it('should detect same full locations regardless of case', () => {
      expect(
        isSameLocation(
          'London, City of Westminster',
          'LONDON, CITY OF WESTMINSTER'
        )
      ).toBe(true)
      expect(
        isSameLocation('Little London, Leeds', 'little london, leeds')
      ).toBe(true)
    })

    it('should detect different locations', () => {
      expect(isSameLocation('London', 'Manchester')).toBe(false)
      expect(isSameLocation('Slough', 'London')).toBe(false)
    })

    it('should handle complex location comparisons', () => {
      expect(isSameLocation('TW18 3HT, Egham', 'tw18 3ht, egham')).toBe(true)
      expect(
        isSameLocation(
          'London, City of Westminster',
          'LONDON, CITY OF WESTMINSTER'
        )
      ).toBe(true)
    })
  })

  describe('formatLocationForUrl', () => {
    it('should convert comma-separated location to slug', () => {
      expect(formatLocationForUrl('Reading, Reading')).toBe('reading_reading')
    })

    it('should handle multi-word parts with hyphens', () => {
      expect(formatLocationForUrl('Bristol, City of Bristol')).toBe(
        'bristol_city-of-bristol'
      )
      expect(formatLocationForUrl('Stockland Bristol, Somerset')).toBe(
        'stockland-bristol_somerset'
      )
      expect(formatLocationForUrl('Bristol Airport, North Somerset')).toBe(
        'bristol-airport_north-somerset'
      )
    })

    it('should handle postcodes by removing spaces and lowercasing', () => {
      expect(formatLocationForUrl('tw183ht')).toBe('tw183ht')
      expect(formatLocationForUrl('TW183HT')).toBe('tw183ht')
      expect(formatLocationForUrl('TW18 3HT')).toBe('tw183ht')
      expect(formatLocationForUrl('tw18 3ht')).toBe('tw183ht')
    })

    it('should use only the postcode when location is "postcode, locality"', () => {
      expect(formatLocationForUrl('N8 7GE, Hornsey')).toBe('n87ge')
      expect(formatLocationForUrl('TW18 3HT, Egham')).toBe('tw183ht')
      expect(formatLocationForUrl('RM1 4XH, London')).toBe('rm14xh')
      expect(formatLocationForUrl('SW1A 1AA, Westminster')).toBe('sw1a1aa')
    })

    it('should detect postcodes case-insensitively', () => {
      expect(formatLocationForUrl('n8 7ge, hornsey')).toBe('n87ge')
      expect(formatLocationForUrl('rm1 4xh, london')).toBe('rm14xh')
    })

    it('should accept postcodes with or without an internal space', () => {
      expect(formatLocationForUrl('N87GE, Hornsey')).toBe('n87ge')
      expect(formatLocationForUrl('TW183HT, Egham')).toBe('tw183ht')
    })

    it('should fall back to slug format when the first part is not a postcode', () => {
      expect(formatLocationForUrl('London, City of Westminster')).toBe(
        'london_city-of-westminster'
      )
      expect(formatLocationForUrl('London Apprentice, Cornwall')).toBe(
        'london-apprentice_cornwall'
      )
    })

    it('should return empty string for falsy input', () => {
      expect(formatLocationForUrl('')).toBe('')
      expect(formatLocationForUrl(null)).toBe('')
      expect(formatLocationForUrl(undefined)).toBe('')
    })

    it('should convert only the first comma to "_" and remaining commas/spaces to "-"', () => {
      expect(
        formatLocationForUrl('Bournemouth, Bournemouth, Christchurch and Poole')
      ).toBe('bournemouth_bournemouth-christchurch-and-poole')
    })

    it('should collapse repeated hyphens introduced by " - " separators in the tail', () => {
      expect(
        formatLocationForUrl(
          'Maes Awyr Caerdydd, Bro Morgannwg - the Vale of Glamorgan'
        )
      ).toBe('maes-awyr-caerdydd_bro-morgannwg-the-vale-of-glamorgan')
    })
  })
})
