import { MongoClient } from 'mongodb'
import { LockManager } from 'mongo-locks'

export const mongoDb = {
  plugin: {
    name: 'mongodb',
    version: '1.0.0',
    register: async function (server, options) {
      server.logger.info('Setting up MongoDb')

      const client = await MongoClient.connect(options.mongoUrl, {
        ...options.mongoOptions
      })

      const databaseName = options.databaseName
      const db = client.db(databaseName)
      const locker = new LockManager(db.collection('mongo-locks'))

      await createIndexes(db)

      server.logger.info(`MongoDb connected to ${databaseName}`)

      server.decorate('server', 'mongoClient', client)
      server.decorate('server', 'db', db)
      server.decorate('server', 'locker', locker)
      server.decorate('request', 'db', () => db, { apply: true })
      server.decorate('request', 'locker', () => locker, { apply: true })

      server.events.on('stop', async () => {
        server.logger.info('Closing Mongo client')
        try {
          await client.close(true)
        } catch (e) {
          server.logger.error(e, 'failed to close mongo client')
        }
      })
    }
  }
}

async function createIndexes(db) {
  await db.collection('mongo-locks').createIndex({ id: 1 })

  // Example of how to create a mongodb index. Remove as required
  await db.collection('example-data').createIndex({ id: 1 })

  await db
    .collection('USERS')
    .createIndex(
      { user_contact: 1 },
      { unique: true, name: 'user_contact_unique' }
    )

  // Pollutant alert dedup key: compound (alert-id + alert-started-timestamp),
  // where alert-id holds the samplingPointId value. Each beyond-24h breach
  // event for a samplingPointId gets its own document (new alert-started-timestamp);
  // the unique constraint prevents duplicate inserts within an event window.
  // Replaces the old single-column unique index on alert-id (dropped by
  // migratePollutantStateToEventModel). Building this on legacy docs is safe:
  // their alert-ids are unique, so the (alert-id, null) keys never collide.
  await db
    .collection('pollutant-alert-processing-state')
    .createIndex(
      { 'alert-id': 1, 'alert-started-timestamp': 1 },
      { unique: true, name: 'alertId_alertStarted_unique' }
    )

  await db.collection('pollutant-alerts-audit').createIndex({ 'alert-id': 1 })

  await db
    .collection('pollutant-alerts-audit')
    .createIndex(
      { 'alert-id': 1, user_contact: 1, location: 1 },
      { unique: true }
    )

  await db
    .collection('metoffice-forecast-audit')
    .createIndex({ forecastDate: 1 })

  await db
    .collection('metoffice-forecast-audit')
    .createIndex(
      { forecastDate: 1, user_contact: 1, location: 1, region: 1 },
      { unique: true }
    )

  await db
    .collection('forecast-schedule-state')
    .createIndex({ forecastDate: 1 }, { unique: true })

  // DAQI alert dedup key: compound (samplingPointId + alert-started-timestamp).
  // A samplingPointId can have multiple event rows — each beyond-24h gap in
  // Ricardo readings starts a new breach event with a new alert-started-timestamp.
  // The unique constraint prevents duplicate inserts for the same event window.
  await db
    .collection('daqi-alert-processing-state')
    .createIndex(
      { samplingPointId: 1, 'alert-started-timestamp': 1 },
      { unique: true, name: 'samplingPointId_alertStarted_unique' }
    )

  await db.collection('daqi-alerts-audit').createIndex({ 'alert-id': 1 })

  await db
    .collection('daqi-alerts-audit')
    .createIndex(
      { 'alert-id': 1, user_contact: 1, location: 1 },
      { unique: true }
    )
}
