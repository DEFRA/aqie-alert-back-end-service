import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node-cron', () => ({
  schedule: vi.fn()
}))

vi.mock('../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'test.cronSchedule') return '*/15 * * * *'
      return null
    })
  }
}))

vi.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('../common/helpers/mongo-lock.js', () => ({
  withLock: vi.fn((_locker, _resource, _logger, fn) => fn())
}))

const { createAlertSchedulerPlugin } = await import(
  './createAlertSchedulerPlugin.js'
)
const { schedule } = await import('node-cron')

describe('createAlertSchedulerPlugin', () => {
  let processFn
  let server
  let eventHandlers
  let extHandlers
  let mockCronJob
  let plugin

  beforeEach(() => {
    vi.clearAllMocks()

    processFn = vi.fn().mockResolvedValue(undefined)
    mockCronJob = { stop: vi.fn() }
    vi.mocked(schedule).mockReturnValue(mockCronJob)

    eventHandlers = {}
    extHandlers = {}
    server = {
      db: {},
      locker: {
        lock: vi
          .fn()
          .mockResolvedValue({ free: vi.fn().mockResolvedValue(undefined) })
      },
      events: {
        on: vi.fn((event, handler) => {
          eventHandlers[event] = handler
        })
      },
      ext: vi.fn((event, handler) => {
        extHandlers[event] = handler
      })
    }

    plugin = createAlertSchedulerPlugin({
      name: 'test-scheduler',
      logLabel: 'Test',
      lockResource: 'test-lock',
      cronConfigKey: 'test.cronSchedule',
      processFn
    })
  })

  it('returns a plugin with the given name and version 1.0.0', () => {
    expect(plugin.plugin.name).toBe('test-scheduler')
    expect(plugin.plugin.version).toBe('1.0.0')
  })

  it('registers start event and onPostStop extension during register', async () => {
    await plugin.plugin.register(server)
    expect(server.events.on).toHaveBeenCalledWith('start', expect.any(Function))
    expect(server.ext).toHaveBeenCalledWith('onPostStop', expect.any(Function))
  })

  it('runs processFn immediately on start', async () => {
    await plugin.plugin.register(server)
    await eventHandlers.start()
    expect(processFn).toHaveBeenCalledWith(server.db)
  })

  it('schedules cron job with the configured expression on start', async () => {
    await plugin.plugin.register(server)
    await eventHandlers.start()
    expect(schedule).toHaveBeenCalledWith('*/15 * * * *', expect.any(Function))
  })

  it('does not throw when startup processFn rejects', async () => {
    processFn.mockRejectedValueOnce(new Error('Startup error'))
    await plugin.plugin.register(server)
    await expect(eventHandlers.start()).resolves.not.toThrow()
  })

  it('calls processFn when cron fires', async () => {
    let cronCallback
    vi.mocked(schedule).mockImplementation((_expr, cb) => {
      cronCallback = cb
      return mockCronJob
    })
    await plugin.plugin.register(server)
    await eventHandlers.start()
    processFn.mockClear()
    await cronCallback()
    expect(processFn).toHaveBeenCalledWith(server.db)
  })

  it('rethrows Error when cron processFn fails', async () => {
    let cronCallback
    vi.mocked(schedule).mockImplementation((_expr, cb) => {
      cronCallback = cb
      return mockCronJob
    })
    await plugin.plugin.register(server)
    await eventHandlers.start()
    processFn.mockRejectedValueOnce(new Error('Cron failure'))
    await expect(cronCallback()).rejects.toThrow('Cron failure')
  })

  it('wraps non-Error thrown by cron processFn', async () => {
    let cronCallback
    vi.mocked(schedule).mockImplementation((_expr, cb) => {
      cronCallback = cb
      return mockCronJob
    })
    await plugin.plugin.register(server)
    await eventHandlers.start()
    processFn.mockRejectedValueOnce('string thrown')
    await expect(cronCallback()).rejects.toThrow('string thrown')
  })

  it('stops cron job on onPostStop after start', async () => {
    await plugin.plugin.register(server)
    await eventHandlers.start()
    extHandlers.onPostStop()
    expect(mockCronJob.stop).toHaveBeenCalled()
  })

  it('does not throw on onPostStop when cron was never started', async () => {
    await plugin.plugin.register(server)
    expect(() => extHandlers.onPostStop()).not.toThrow()
    expect(mockCronJob.stop).not.toHaveBeenCalled()
  })

  it('throws when register itself throws an Error', async () => {
    server.events.on.mockImplementation(() => {
      throw new Error('Register error')
    })
    await expect(plugin.plugin.register(server)).rejects.toThrow(
      'Register error'
    )
  })

  it('wraps and rethrows non-Error thrown during register', async () => {
    server.events.on.mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'non-error thrown'
    })
    await expect(plugin.plugin.register(server)).rejects.toThrow(
      'non-error thrown'
    )
  })
})
