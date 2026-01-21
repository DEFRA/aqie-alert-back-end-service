import Boom from '@hapi/boom'
import { sendNotification } from '../utils/notifyServiceClient.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  maskPhoneNumber,
  maskEmail,
  maskTemplateId
} from '../utils/maskingUtils.js'
import { normalizeLocation, isSameLocation } from '../utils/locationUtils.js'
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

  const userContact = phoneNumber || emailAddress

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
    // Check if user exists and update locations, or create new user
    const dbStartTime = Date.now()
    logger.info(
      { requestId, collection: 'USERS' },
      'Starting database operation'
    )

    const userIdentifier = { user_contact: userContact }

    // Check for duplicate location and location limit
    const existingUser = await db.collection('USERS').findOne(userIdentifier)

    if (existingUser) {
      // Check for duplicate location using normalized comparison (location name only)
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

    const dbDuration = Date.now() - dbStartTime

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
        dbDuration,
        isNewUser
      },
      'User and location successfully processed in database'
    )

    // Prepare notification payload
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
      'Prepared notification payload'
    )

    // Call to aqie-notify-service - fail if notification fails
    const notifyStartTime = Date.now()
    try {
      logger.info({ requestId }, 'Initiating notification service call')
      await sendNotification(notifyPayload, requestId)
      const notifyDuration = Date.now() - notifyStartTime
      logger.info(
        { requestId, notifyDuration },
        'Notification service call completed successfully'
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
        'Notification service call failed - rolling back user creation'
      )

      // Rollback: Remove the added location
      try {
        await db
          .collection('USERS')
          .updateOne({ _id: userId }, { $pull: { locations: locationData } })
        logger.info({ requestId, userId }, 'Location rollback completed')
      } catch (rollbackErr) {
        logger.error(
          { requestId, rollbackErr: rollbackErr.message },
          'Rollback failed'
        )
      }

      return Boom.badGateway(
        'Alert setup failed - notification service unavailable'
      )
    }

    const totalDuration = Date.now() - startTime
    const response = { message: 'Alert setup successful', userId }

    logger.info(
      {
        requestId,
        userId,
        totalDuration,
        dbDuration,
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
