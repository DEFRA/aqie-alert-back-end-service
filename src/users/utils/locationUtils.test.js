import { describe, it, expect } from 'vitest'
import { normalizeLocation, isSameLocation } from './locationUtils.js'

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
      expect(normalizeLocation(null)).toBe(null)
      expect(normalizeLocation(undefined)).toBe(undefined)
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
})
