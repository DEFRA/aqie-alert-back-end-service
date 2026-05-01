import { randomUUID } from 'node:crypto'
import Boom from '@hapi/boom'
import { sendNotification } from '../utils/notifyServiceClient.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  maskPhoneNumber,
  maskEmail,
  maskTemplateId
} from '../utils/maskingUtils.js'
import { normalizeLocation, isSameLocation } from '../utils/locationUtils.js'
import { normalizePhoneNumber } from '../utils/validationUtils.js'
import { config } from '../../config.js'
import { findRegion } from '../utils/regionFinder.js'
import {
  MAGIC_NO_201,
  MAGIC_NO_DB_ERROR_CODE,
  MAGIC_NO_FIVE
} from '../utils/constants.js'

const logger = createLogger()

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequestContext(request) {
  const { phoneNumber, emailAddress, alertType, location, lat, long, lang } =
    request.payload
  const requestId = request.headers['x-request-id'] || `req-${randomUUID()}`

  logger.info(
    `Setup alert handler started ${JSON.stringify({
      requestId,
      payload: {
        ...request.payload,
        phoneNumber: maskPhoneNumber(phoneNumber),
        emailAddress: maskEmail(emailAddress)
      },
      userAgent: request.headers['user-agent'],
      ip: request.info.remoteAddress
    })}`
  )

  return {
    requestId,
    phoneNumber,
    emailAddress,
    alertType,
    location,
    lat,
    long,
    lang
  }
}

async function validateDuplicateAndLimit(
  db,
  userIdentifier,
  location,
  normalizedLocation,
  lat,
  long,
  requestId
) {
  logger.info(
    `Checking for duplicate location and user limits ${JSON.stringify({ requestId, collection: 'USERS' })}`
  )

  const existingUser = await db.collection('USERS').findOne(userIdentifier)
  if (!existingUser) {
    return null
  }

  const isDuplicate = existingUser.locations?.some((loc) =>
    isSameLocation(loc.location, location)
  )

  if (isDuplicate) {
    logger.warn(
      `Duplicate location detected ${JSON.stringify({ requestId, location: normalizedLocation, lat, long })}`
    )
    return Boom.conflict('Alert already exists for this location')
  }

  if (existingUser.locations?.length >= MAGIC_NO_FIVE) {
    logger.warn(
      `Location limit exceeded ${JSON.stringify({ requestId, locationCount: existingUser.locations.length })}`
    )
    return Boom.badRequest('Maximum 5 locations allowed per user')
  }

  return null
}

function buildNotifyPayload(alertType, phoneNumber, emailAddress, location) {
  const templateId =
    alertType === 'sms'
      ? config.get('notification.templates.smsSetUpConfirmation')
      : config.get('notification.templates.emailSetUpConfirmation')

  const personalisation = { location }

  if (alertType === 'email') {
    const baseUrl = config.get('notification.templates.unsubscribeEmailLink')
    personalisation.unsubscribeLink = `${baseUrl}?email=${encodeURIComponent(emailAddress)}`
  }

  return {
    phoneNumber: phoneNumber || undefined,
    emailAddress: emailAddress || undefined,
    templateId,
    personalisation
  }
}

async function dispatchSetupNotification(
  notifyPayload,
  requestId,
  phoneNumber,
  emailAddress
) {
  const notifyStartTime = Date.now()
  logger.info(
    `Validating with notification service before database operation ${JSON.stringify({ requestId })}`
  )

  try {
    await sendNotification(notifyPayload, requestId)
    const notifyDuration = Date.now() - notifyStartTime
    logger.info(
      `Notification service validation successful ${JSON.stringify({ requestId, notifyDuration })}`
    )
    return null
  } catch (err) {
    const notifyDuration = Date.now() - notifyStartTime
    logger.error(
      `Notification service validation failed - stopping before database operation ${JSON.stringify(
        {
          requestId,
          err: err.message,
          stack: err.stack,
          notifyDuration,
          notifyPayload: {
            ...notifyPayload,
            phoneNumber: maskPhoneNumber(phoneNumber),
            emailAddress: maskEmail(emailAddress),
            templateId: maskTemplateId(notifyPayload.templateId)
          }
        }
      )}`
    )
    return Boom.badGateway(
      'Alert setup failed - notification service unavailable or invalid contact details'
    )
  }
}

async function saveUserLocation(
  db,
  userIdentifier,
  userContact,
  alertType,
  preferredLang,
  locationData,
  requestId
) {
  const dbSaveStartTime = Date.now()
  logger.info(
    `Starting database save operation ${JSON.stringify({ requestId, collection: 'USERS' })}`
  )

  const result = await db.collection('USERS').findOneAndUpdate(
    userIdentifier,
    {
      $setOnInsert: {
        user_contact: userContact,
        alertType,
        createdAt: new Date(),
        requestId
      },
      $set: { lang: preferredLang },
      $push: { locations: locationData }
    },
    { upsert: true, returnDocument: 'after' }
  )

  const dbSaveDuration = Date.now() - dbSaveStartTime
  logger.info(
    `User and location successfully saved to database ${JSON.stringify({
      requestId,
      userId: result?._id,
      dbSaveDuration,
      isNewUser: result?.locations?.length === 1
    })}`
  )

  return { result, dbSaveDuration }
}

function validateDbAndPrepare(db, context) {
  const { requestId, phoneNumber, emailAddress, location, lat, long, lang } =
    context

  if (!db) {
    logger.error(
      `Database connection not available ${JSON.stringify({ requestId })}`
    )
    return { error: Boom.internal('Database connection error') }
  }

  logger.info(
    `Database connection verified ${JSON.stringify({ requestId, dbName: db.databaseName })}`
  )

  const normalizedLocation = normalizeLocation(location)
  const region = findRegion(lat, long)
  logger.info(
    `Region determination completed ${JSON.stringify({ requestId, lat, long, region })}`
  )

  const locationData = {
    location,
    coordinates: [long, lat],
    createdAt: new Date(),
    region
  }
  const preferredLang = lang || 'en'
  const userContact = normalizePhoneNumber(phoneNumber) || emailAddress
  const userIdentifier = { user_contact: userContact }

  logger.info(
    `Prepared location data for processing ${JSON.stringify({
      requestId,
      locationData: {
        ...locationData,
        phoneNumber: maskPhoneNumber(phoneNumber),
        emailAddress: maskEmail(emailAddress)
      }
    })}`
  )

  return {
    normalizedLocation,
    locationData,
    preferredLang,
    userContact,
    userIdentifier
  }
}

async function buildAndSendNotification(
  alertType,
  phoneNumber,
  emailAddress,
  location,
  requestId
) {
  const notifyPayload = buildNotifyPayload(
    alertType,
    phoneNumber,
    emailAddress,
    location
  )
  logger.info(
    `Prepared notification payload for validation ${JSON.stringify({
      requestId,
      notifyPayload: {
        ...notifyPayload,
        phoneNumber: maskPhoneNumber(phoneNumber),
        emailAddress: maskEmail(emailAddress),
        templateId: maskTemplateId(notifyPayload.templateId)
      }
    })}`
  )
  return dispatchSetupNotification(
    notifyPayload,
    requestId,
    phoneNumber,
    emailAddress
  )
}

async function persistAndBuildResponse(
  db,
  prepared,
  alertType,
  requestId,
  startTime,
  duplicateCheckDuration,
  h
) {
  const { userIdentifier, userContact, preferredLang, locationData } = prepared
  const { result, dbSaveDuration } = await saveUserLocation(
    db,
    userIdentifier,
    userContact,
    alertType,
    preferredLang,
    locationData,
    requestId
  )

  if (!result) {
    logger.error(
      `Database operation failed - no result returned ${JSON.stringify({ requestId })}`
    )
    return Boom.internal('Failed to process user data')
  }

  const totalDuration = Date.now() - startTime
  const response = { message: 'Alert setup successful', userId: result._id }
  logger.info(
    `Setup alert handler completed successfully ${JSON.stringify({
      requestId,
      userId: result._id,
      totalDuration,
      duplicateCheckDuration,
      dbSaveDuration,
      response
    })}`
  )
  return h.response(response).code(MAGIC_NO_201)
}

async function runAlertPipeline(db, context, prepared, startTime, h) {
  const {
    requestId,
    phoneNumber,
    emailAddress,
    alertType,
    location,
    lat,
    long
  } = context
  const { normalizedLocation, locationData } = prepared

  try {
    const dbStartTime = Date.now()
    const duplicateError = await validateDuplicateAndLimit(
      db,
      prepared.userIdentifier,
      location,
      normalizedLocation,
      lat,
      long,
      requestId
    )
    const duplicateCheckDuration = Date.now() - dbStartTime
    if (duplicateError) {
      return duplicateError
    }
    logger.info(
      `Duplicate location check completed - proceeding with notification ${JSON.stringify({ requestId, duplicateCheckDuration })}`
    )

    const notifyError = await buildAndSendNotification(
      alertType,
      phoneNumber,
      emailAddress,
      location,
      requestId
    )
    if (notifyError) {
      return notifyError
    }

    return await persistAndBuildResponse(
      db,
      prepared,
      alertType,
      requestId,
      startTime,
      duplicateCheckDuration,
      h
    )
  } catch (err) {
    const totalDuration = Date.now() - startTime
    logger.error(
      `Setup alert handler failed with database error ${JSON.stringify({
        requestId,
        err: err.message,
        stack: err.stack,
        totalDuration,
        locationData: {
          ...locationData,
          phoneNumber: maskPhoneNumber(phoneNumber),
          emailAddress: maskEmail(emailAddress)
        }
      })}`
    )
    if (err.code === MAGIC_NO_DB_ERROR_CODE) {
      logger.warn(
        `Duplicate key error detected ${JSON.stringify({ requestId, duplicateKey: err.keyValue })}`
      )
      return Boom.conflict('Location already exists for this user')
    }
    return Boom.internal('Failed to setup alert')
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function setupAlertHandler(request, h) {
  const startTime = Date.now()
  const context = buildRequestContext(request)
  const prepared = validateDbAndPrepare(request.db, context)
  if (prepared.error) {
    return prepared.error
  }
  return runAlertPipeline(request.db, context, prepared, startTime, h)
}
