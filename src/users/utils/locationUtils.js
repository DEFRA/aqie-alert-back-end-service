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

  return location.trim().toLowerCase().replace(/\s+/g, ' ') // Replace multiple spaces with single space
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
