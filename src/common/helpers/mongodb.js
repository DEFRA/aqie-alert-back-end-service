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

  await db
    .collection('pollutant-alert-processing-state')
    .createIndex({ 'alert-id': 1 }, { unique: true })

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

  // DAQI alert dedup key: a single alert is identified by the combination of
  // samplingPointId + siteId + date (compound unique). The schedule re-runs
  // every 15 minutes; this index ensures the same breach is not re-processed.
  await db
    .collection('daqi-alert-processing-state')
    .createIndex({ samplingPointId: 1, siteId: 1, date: 1 }, { unique: true })

  await db.collection('daqi-alerts-audit').createIndex({ 'alert-id': 1 })

  await db
    .collection('daqi-alerts-audit')
    .createIndex(
      { 'alert-id': 1, user_contact: 1, location: 1 },
      { unique: true }
    )
}
