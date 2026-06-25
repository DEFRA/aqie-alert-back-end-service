import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('node-cron', () => ({
  schedule: vi.fn()
}))

vi.mock('../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'ricardoApi.daqiCronSchedule') return '*/15 * * * *'
      return null
    })
  }
}))

vi.mock('../users/utils/daqiAlertProcessor.js', () => ({
  processDaqiAlerts: vi.fn()
}))

vi.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('daqi-alert-scheduler', () => {
  let daqiAlertScheduler
  let mockSchedule
  let mockProcessDaqiAlerts
  let mockCronJob
  let server
  let eventHandlers
  let extHandlers

  beforeEach(async () => {
    vi.clearAllMocks()

    mockCronJob = { stop: vi.fn() }
    mockSchedule = vi.mocked((await import('node-cron')).schedule)
    mockSchedule.mockReturnValue(mockCronJob)

    mockProcessDaqiAlerts = vi.mocked(
      (await import('../users/utils/daqiAlertProcessor.js')).processDaqiAlerts
    )
    mockProcessDaqiAlerts.mockResolvedValue(undefined)

    eventHandlers = {}
    extHandlers = {}

    server = {
      db: { collection: vi.fn() },
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

    vi.resetModules()
    const mod = await import('./daqi-alert-scheduler.js')
    daqiAlertScheduler = mod.daqiAlertScheduler
  })

  it('should have correct plugin name and version', () => {
    expect(daqiAlertScheduler.plugin.name).toBe('daqi-alert-scheduler')
    expect(daqiAlertScheduler.plugin.version).toBe('1.0.0')
  })

  it('should register start event handler on register', async () => {
    await daqiAlertScheduler.plugin.register(server)
    expect(server.events.on).toHaveBeenCalledWith('start', expect.any(Function))
  })

  it('should register onPostStop extension on register', async () => {
    await daqiAlertScheduler.plugin.register(server)
    expect(server.ext).toHaveBeenCalledWith('onPostStop', expect.any(Function))
  })

  it('should run processDaqiAlerts immediately on start', async () => {
    await daqiAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    expect(mockProcessDaqiAlerts).toHaveBeenCalledWith(server.db)
  })

  it('should schedule cron job with configured schedule on start', async () => {
    await daqiAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    expect(mockSchedule).toHaveBeenCalledWith(
      '*/15 * * * *',
      expect.any(Function)
    )
  })

  it('should catch and log startup run errors without throwing', async () => {
    mockProcessDaqiAlerts.mockRejectedValueOnce(
      new Error('Startup fetch failed')
    )

    await daqiAlertScheduler.plugin.register(server)
    await expect(eventHandlers.start()).resolves.not.toThrow()
  })

  it('should call processDaqiAlerts when cron job fires', async () => {
    let capturedCronCallback
    mockSchedule.mockImplementation((_expr, callback) => {
      capturedCronCallback = callback
      return mockCronJob
    })

    await daqiAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    mockProcessDaqiAlerts.mockClear()
    await capturedCronCallback()

    expect(mockProcessDaqiAlerts).toHaveBeenCalledWith(server.db)
  })

  it('should rethrow cron job errors', async () => {
    const cronError = new Error('DB unavailable')
    let capturedCronCallback
    mockSchedule.mockImplementation((_expr, callback) => {
      capturedCronCallback = callback
      return mockCronJob
    })

    await daqiAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    mockProcessDaqiAlerts.mockRejectedValueOnce(cronError)
    await expect(capturedCronCallback()).rejects.toThrow('DB unavailable')
  })

  it('should wrap non-Error thrown in cron callback into an Error', async () => {
    let capturedCronCallback
    mockSchedule.mockImplementation((_expr, callback) => {
      capturedCronCallback = callback
      return mockCronJob
    })

    await daqiAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    mockProcessDaqiAlerts.mockRejectedValueOnce('plain string error')
    await expect(capturedCronCallback()).rejects.toThrow('plain string error')
  })

  it('should stop cron job on onPostStop', async () => {
    await daqiAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    extHandlers.onPostStop()

    expect(mockCronJob.stop).toHaveBeenCalled()
  })

  it('should not stop cron job on onPostStop if start never fired', async () => {
    await daqiAlertScheduler.plugin.register(server)
    extHandlers.onPostStop()
    expect(mockCronJob.stop).not.toHaveBeenCalled()
  })

  it('should throw and log when server.events.on throws an Error', async () => {
    server.events.on.mockImplementation(() => {
      throw new Error('Registration failed')
    })

    await expect(daqiAlertScheduler.plugin.register(server)).rejects.toThrow(
      'Registration failed'
    )
  })

  it('should wrap and rethrow non-Error thrown during register', async () => {
    server.events.on.mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error'
    })

    await expect(daqiAlertScheduler.plugin.register(server)).rejects.toThrow(
      'string error'
    )
  })
})
