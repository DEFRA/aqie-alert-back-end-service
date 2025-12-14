export async function setupDatabase(db) {
  try {
    console.log('Creating unique index for user_contact...')

    const collection = db.collection('USERS')

    // Unique index for user_contact (phone or email)
    await collection.createIndex(
      { user_contact: 1 },
      { unique: true, name: 'user_contact_unique' }
    )

    console.log('Database setup completed successfully')
  } catch (error) {
    console.error('Database setup failed:', error)
    throw error
  }
}
