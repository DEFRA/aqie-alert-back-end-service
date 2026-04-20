import { MINUS_FOUR } from './constants.js'

export function maskPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return null
  }
  return phoneNumber.length > 4
    ? `****${phoneNumber.slice(MINUS_FOUR)}`
    : '****'
}

export function maskEmail(email) {
  if (!email || typeof email !== 'string') {
    return null
  }
  const [local, domain] = email.split('@')
  if (!domain) {
    return '****'
  }
  return `${local.slice(0, 2)}****@${domain}`
}

export function maskTemplateId(templateId) {
  if (!templateId || typeof templateId !== 'string') {
    return null
  }
  return templateId.length > 8 ? `****${templateId.slice(MINUS_FOUR)}` : '****'
}
