// Cap inputs at this length before any regex work — defends against
// pathologically long strings consuming CPU even on linear-time patterns.
// Realistic UK location names are well under 200 chars.
const MAX_LOCATION_LENGTH = 500

/**
 * Normalizes location names for consistent comparison and storage
 * Preserves full location context (e.g., "London, City of Westminster" vs "London Apprentice, Cornwall")
 * Non-string input is returned unchanged.
 * @param {*} location - The location string to normalize
 * @returns {*} - Normalized location string, or the original value if not a string
 */
export function normalizeLocation(location) {
  if (!location || typeof location !== 'string') {
    return location
  }

  return location
    .slice(0, MAX_LOCATION_LENGTH)
    .trim()
    .toLowerCase()
    .replaceAll(/\s{1,200}/g, ' ') // collapse runs of whitespace; bounded to prevent ReDoS
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
// All quantifiers are bounded so the engine cannot backtrack catastrophically.
const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]?\s{0,10}\d[A-Z]{2}$/i

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
  // Bound input before any regex work — defends against ReDoS on untrusted input
  const trimmed = location.slice(0, MAX_LOCATION_LENGTH).trim()
  if (trimmed.includes(',')) {
    const firstComma = trimmed.indexOf(',')
    const first = trimmed.slice(0, firstComma).trim()
    const rest = trimmed.slice(firstComma + 1).trim()
    if (UK_POSTCODE_REGEX.test(first)) {
      return first.toLowerCase().replaceAll(/\s{1,200}/g, '')
    }
    const firstSlug = first.toLowerCase().replaceAll(/\s{1,200}/g, '-')
    const restSlug = rest
      .toLowerCase()
      .replaceAll(/[,\s]{1,200}/g, '-')
      .replaceAll(/-{1,200}/g, '-')
      .replace(/^-{1,200}|-{1,200}$/g, '')
    return `${firstSlug}_${restSlug}`
  }
  return trimmed.toLowerCase().replaceAll(/\s{1,200}/g, '')
}
