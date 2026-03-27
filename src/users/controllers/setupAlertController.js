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

const logger = createLogger()

export async function setupAlertHandler(request, h) {
  const requestId =
    request.headers['x-request-id'] ||
    `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const startTime = Date.now()

  logger.info(
    `Setup alert handler started ${JSON.stringify({
      requestId,
      payload: {
        ...request.payload,
        phoneNumber: maskPhoneNumber(request.payload.phoneNumber),
        emailAddress: maskEmail(request.payload.emailAddress)
      },
      userAgent: request.headers['user-agent'],
      ip: request.info.remoteAddress
    })}`
  )

  const { phoneNumber, emailAddress, alertType, location, lat, long, lang } =
    request.payload
  const db = request.db

  // Validate database connection
  if (!db) {
    logger.error(
      `Database connection not available ${JSON.stringify({ requestId })}`
    )
    return Boom.internal('Database connection error')
  }

  logger.info(
    `Database connection verified ${JSON.stringify({ requestId, dbName: db.databaseName })}`
  )

  const normalizedLocation = normalizeLocation(location)

  // Determine region from lat/long using GeoBoundaries
  const region = findRegion(lat, long)

  logger.info(
    `Region determination completed ${JSON.stringify({ requestId, lat, long, region })}`
  )

  const locationData = {
    location, // Store original format as received
    coordinates: [long, lat], // GeoJSON format [longitude, latitude]
    createdAt: new Date(),
    region // Include region information
  }

  const preferredLang = lang || 'en'
  const userContact = normalizePhoneNumber(phoneNumber) || emailAddress

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

  try {
    // STEP 1: Check for duplicate location and location limit BEFORE notification
    const dbStartTime = Date.now()
    logger.info(
      `Checking for duplicate location and user limits ${JSON.stringify({ requestId, collection: 'USERS' })}`
    )

    const userIdentifier = { user_contact: userContact }
    const existingUser = await db.collection('USERS').findOne(userIdentifier)

    if (existingUser) {
      // Check for duplicate location using normalized comparison
      const isDuplicate = existingUser.locations?.some((loc) =>
        isSameLocation(loc.location, location)
      )

      if (isDuplicate) {
        logger.warn(
          `Duplicate location detected ${JSON.stringify({ requestId, location: normalizedLocation, lat, long })}`
        )
        return Boom.conflict('Alert already exists for this location')
      }

      // Check location limit (max 5 locations)
      if (existingUser.locations?.length >= 5) {
        logger.warn(
          `Location limit exceeded ${JSON.stringify({ requestId, locationCount: existingUser.locations.length })}`
        )
        return Boom.badRequest('Maximum 5 locations allowed per user')
      }
    }

    const duplicateCheckDuration = Date.now() - dbStartTime
    logger.info(
      `Duplicate location check completed - proceeding with notification ${JSON.stringify({ requestId, duplicateCheckDuration })}`
    )

    // STEP 2: Validate with notification service after duplicate check
    const templateId =
      alertType === 'sms'
        ? config.get('notification.templates.smsSetUpConfirmation')
        : config.get('notification.templates.emailSetUpConfirmation')

    const personalisation = { location }

    // Add unsubscribeLink only for email templates with dynamic email parameter
    if (alertType === 'email') {
      const baseUrl = config.get('notification.templates.unsubscribeEmailLink')
      personalisation.unsubscribeLink = `${baseUrl}?email=${encodeURIComponent(emailAddress)}`
    }

    const notifyPayload = {
      phoneNumber: phoneNumber || undefined,
      emailAddress: emailAddress || undefined,
      templateId,
      personalisation
    }

    logger.info(
      `Prepared notification payload for validation ${JSON.stringify({
        requestId,
        notifyPayload: {
          ...notifyPayload,
          phoneNumber: maskPhoneNumber(phoneNumber),
          emailAddress: maskEmail(emailAddress),
          templateId: maskTemplateId(templateId)
        }
      })}`
    )

    // STEP 1: Validate with notification service FIRST
    const notifyStartTime = Date.now()
    try {
      logger.info(
        `Validating with notification service before database operation ${JSON.stringify({ requestId })}`
      )
      await sendNotification(notifyPayload, requestId)
      const notifyDuration = Date.now() - notifyStartTime
      logger.info(
        `Notification service validation successful ${JSON.stringify({ requestId, notifyDuration })}`
      )
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

    // STEP 3: Save to database after successful notification validation
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

    if (!result) {
      logger.error(
        `Database operation failed - no result returned ${JSON.stringify({ requestId, result })}`
      )
      return Boom.internal('Failed to process user data')
    }

    const userId = result._id
    const isNewUser = result.locations?.length === 1

    logger.info(
      `User and location successfully saved to database ${JSON.stringify({
        requestId,
        userId,
        dbSaveDuration,
        isNewUser
      })}`
    )

    const totalDuration = Date.now() - startTime
    const response = { message: 'Alert setup successful', userId }

    logger.info(
      `Setup alert handler completed successfully ${JSON.stringify({
        requestId,
        userId,
        totalDuration,
        duplicateCheckDuration,
        dbSaveDuration,
        response
      })}`
    )

    return h.response(response).code(201)
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

    if (err.code === 11000) {
      logger.warn(
        `Duplicate key error detected ${JSON.stringify({ requestId, duplicateKey: err.keyValue })}`
      )
      return Boom.conflict('Location already exists for this user')
    }

    return Boom.internal('Failed to setup alert')
  }
}
