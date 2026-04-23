async function acquireLock(locker, resource, logger) {
  const lock = await locker.lock(resource)
  if (!lock) {
    if (logger) {
      logger.error(`Failed to acquire lock for ${resource}`)
    }
    return null
  }
  return lock
}

async function requireLock(locker, resource) {
  const lock = await locker.lock(resource)
  if (!lock) {
    throw new Error(`Failed to acquire lock for ${resource}`)
  }
  return lock
}

async function withLock(locker, resource, logger, fn) {
  const lock = await locker.lock(resource)
  if (!lock) {
    logger.info(`Skipping cycle — lock '${resource}' held by another instance`)
    return
  }
  try {
    await fn()
  } finally {
    await lock.free()
  }
}

export { acquireLock, requireLock, withLock }
