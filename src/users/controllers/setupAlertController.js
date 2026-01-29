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

const logger = createLogger()

export async function setupAlertHandler(request, h) {
  const requestId =
    request.headers['x-request-id'] ||
    `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const startTime = Date.now()

  logger.info(
    {
      requestId,
      payload: {
        ...request.payload,
        phoneNumber: maskPhoneNumber(request.payload.phoneNumber),
        emailAddress: maskEmail(request.payload.emailAddress)
      },
      userAgent: request.headers['user-agent'],
      ip: request.info.remoteAddress
    },
    'Setup alert handler started'
  )

  const { phoneNumber, emailAddress, alertType, location, lat, long } =
    request.payload
  const db = request.db

  // Validate database connection
  if (!db) {
    logger.error({ requestId }, 'Database connection not available')
    return Boom.internal('Database connection error')
  }

  logger.info(
    { requestId, dbName: db.databaseName },
    'Database connection verified'
  )

  const normalizedLocation = normalizeLocation(location)
  const locationData = {
    location, // Store original format as received
    coordinates: [long, lat], // GeoJSON format [longitude, latitude]
    createdAt: new Date()
  }

  const userContact = normalizePhoneNumber(phoneNumber) || emailAddress

  logger.info(
    {
      requestId,
      locationData: {
        ...locationData,
        phoneNumber: maskPhoneNumber(phoneNumber),
        emailAddress: maskEmail(emailAddress)
      }
    },
    'Prepared location data for processing'
  )

  try {
    // STEP 1: Check for duplicate location and location limit BEFORE notification
    const dbStartTime = Date.now()
    logger.info(
      { requestId, collection: 'USERS' },
      'Checking for duplicate location and user limits'
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
          { requestId, location: normalizedLocation, lat, long },
          'Duplicate location detected'
        )
        return Boom.conflict('Alert already exists for this location')
      }

      // Check location limit (max 5 locations)
      if (existingUser.locations?.length >= 5) {
        logger.warn(
          { requestId, locationCount: existingUser.locations.length },
          'Location limit exceeded'
        )
        return Boom.badRequest('Maximum 5 locations allowed per user')
      }
    }

    const duplicateCheckDuration = Date.now() - dbStartTime
    logger.info(
      { requestId, duplicateCheckDuration },
      'Duplicate location check completed - proceeding with notification'
    )

    // STEP 2: Validate with notification service after duplicate check
    const templateId =
      alertType === 'sms'
        ? config.get('notification.templates.smsSetUpConfirmation')
        : config.get('notification.templates.emailSetUpConfirmation')
    const notifyPayload = {
      phoneNumber: phoneNumber || undefined,
      emailAddress: emailAddress || undefined,
      templateId,
      personalisation: { location } // Use original format
    }

    logger.info(
      {
        requestId,
        notifyPayload: {
          ...notifyPayload,
          phoneNumber: maskPhoneNumber(phoneNumber),
          emailAddress: maskEmail(emailAddress),
          templateId: maskTemplateId(templateId)
        }
      },
      'Prepared notification payload for validation'
    )

    // STEP 1: Validate with notification service FIRST
    const notifyStartTime = Date.now()
    try {
      logger.info(
        { requestId },
        'Validating with notification service before database operation'
      )
      await sendNotification(notifyPayload, requestId)
      const notifyDuration = Date.now() - notifyStartTime
      logger.info(
        { requestId, notifyDuration },
        'Notification service validation successful'
      )
    } catch (err) {
      const notifyDuration = Date.now() - notifyStartTime
      logger.error(
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
        },
        'Notification service validation failed - stopping before database operation'
      )

      return Boom.badGateway(
        'Alert setup failed - notification service unavailable or invalid contact details'
      )
    }

    // STEP 3: Save to database after successful notification validation
    const dbSaveStartTime = Date.now()
    logger.info(
      { requestId, collection: 'USERS' },
      'Starting database save operation'
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
        $push: { locations: locationData }
      },
      { upsert: true, returnDocument: 'after' }
    )

    const dbSaveDuration = Date.now() - dbSaveStartTime

    if (!result) {
      logger.error(
        { requestId, result },
        'Database operation failed - no result returned'
      )
      return Boom.internal('Failed to process user data')
    }

    const userId = result._id
    const isNewUser = result.locations?.length === 1

    logger.info(
      {
        requestId,
        userId,
        dbSaveDuration,
        isNewUser
      },
      'User and location successfully saved to database'
    )

    const totalDuration = Date.now() - startTime
    const response = { message: 'Alert setup successful', userId }

    logger.info(
      {
        requestId,
        userId,
        totalDuration,
        duplicateCheckDuration,
        dbSaveDuration,
        response
      },
      'Setup alert handler completed successfully'
    )

    return h.response(response).code(201)
  } catch (err) {
    const totalDuration = Date.now() - startTime
    logger.error(
      {
        requestId,
        err: err.message,
        stack: err.stack,
        totalDuration,
        locationData: {
          ...locationData,
          phoneNumber: maskPhoneNumber(phoneNumber),
          emailAddress: maskEmail(emailAddress)
        }
      },
      'Setup alert handler failed with database error'
    )

    if (err.code === 11000) {
      logger.warn(
        { requestId, duplicateKey: err.keyValue },
        'Duplicate key error detected'
      )
      return Boom.conflict('Location already exists for this user')
    }

    return Boom.internal('Failed to setup alert')
  }
}
