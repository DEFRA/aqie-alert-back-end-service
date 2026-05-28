/**
 * Normalizes location names for consistent comparison and storage
 * Preserves full location context (e.g., "London, City of Westminster" vs "London Apprentice, Cornwall")
 * @param {string} location - The location string to normalize
 * @returns {string} - Normalized location string
 */
export function normalizeLocation(location) {
  if (!location || typeof location !== 'string') {
    return location
  }

  return location.trim().toLowerCase().replaceAll(/\s+/g, ' ') // Replace multiple spaces with single space
}

/**
 * Checks if two locations are the same after normalization
 * Considers full location context to differentiate between similar names
 * @param {string} location1 - First location
 * @param {string} location2 - Second location
 * @returns {boolean} - True if locations are exactly the same
 */
export function isSameLocation(location1, location2) {
  return normalizeLocation(location1) === normalizeLocation(location2)
}

// UK postcode: 1–2 area letters, district digit, optional district letter/digit,
// optional space, sector digit, 2 unit letters. Case-insensitive.
const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i

/**
 * Formats a location name into a URL slug for the checkAirQualityLink used in
 * alert emails/SMS. Used by both the pollutant and forecast alert schedulers.
 *
 * Rules:
 *  - Empty/falsy → ''
 *  - "<postcode>, <locality>" → postcode only, lowercased, spaces stripped
 *    e.g. "N8 7GE, Hornsey" → "n87ge"
 *  - "<place>, <area>" (non-postcode) → first comma becomes '_', any further
 *    commas and all whitespace become '-' (collapsing repeats)
 *    e.g. "London, City of Westminster" → "london_city-of-westminster"
 *    e.g. "Bournemouth, Bournemouth, Christchurch and Poole"
 *         → "bournemouth_bournemouth-christchurch-and-poole"
 *    e.g. "Maes Awyr Caerdydd, Bro Morgannwg - the Vale of Glamorgan"
 *         → "maes-awyr-caerdydd_bro-morgannwg-the-vale-of-glamorgan"
 *  - "<single token>" (no comma) → lowercased, spaces stripped
 *    e.g. "TW18 3HT" → "tw183ht"
 *
 * @param {string} location - The location string to format
 * @returns {string} - URL slug
 */
export function formatLocationForUrl(location) {
  if (!location) {
    return ''
  }
  const trimmed = location.trim()
  if (trimmed.includes(',')) {
    const firstComma = trimmed.indexOf(',')
    const first = trimmed.slice(0, firstComma).trim()
    const rest = trimmed.slice(firstComma + 1).trim()
    if (UK_POSTCODE_REGEX.test(first)) {
      return first.toLowerCase().replaceAll(/\s+/g, '')
    }
    const firstSlug = first.toLowerCase().replaceAll(/\s+/g, '-')
    const restSlug = rest
      .toLowerCase()
      .replaceAll(/[,\s]+/g, '-')
      .replaceAll(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
    return `${firstSlug}_${restSlug}`
  }
  return trimmed.toLowerCase().replaceAll(/\s+/g, '')
}
