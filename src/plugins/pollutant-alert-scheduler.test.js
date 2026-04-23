import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('node-cron', () => ({
  schedule: vi.fn()
}))

vi.mock('../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'ricardoApi.cronSchedule') return '*/30 * * * *'
      return null
    })
  }
}))

vi.mock('../users/utils/pollutantAlertProcessor.js', () => ({
  processPollutantAlerts: vi.fn()
}))

vi.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('pollutant-alert-scheduler', () => {
  let pollutantAlertScheduler
  let mockSchedule
  let mockProcessPollutantAlerts
  let mockCronJob
  let server
  let eventHandlers
  let extHandlers

  beforeEach(async () => {
    vi.clearAllMocks()

    mockCronJob = { stop: vi.fn() }
    mockSchedule = vi.mocked((await import('node-cron')).schedule)
    mockSchedule.mockReturnValue(mockCronJob)

    mockProcessPollutantAlerts = vi.mocked(
      (await import('../users/utils/pollutantAlertProcessor.js'))
        .processPollutantAlerts
    )
    mockProcessPollutantAlerts.mockResolvedValue(undefined)

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

    // Re-import the module fresh each time to reset module-level cronJob variable
    vi.resetModules()
    const mod = await import('./pollutant-alert-scheduler.js')
    pollutantAlertScheduler = mod.pollutantAlertScheduler
  })

  it('should have correct plugin name and version', () => {
    expect(pollutantAlertScheduler.plugin.name).toBe(
      'pollutant-alert-scheduler'
    )
    expect(pollutantAlertScheduler.plugin.version).toBe('1.0.0')
  })

  it('should register start event handler on register', async () => {
    await pollutantAlertScheduler.plugin.register(server)
    expect(server.events.on).toHaveBeenCalledWith('start', expect.any(Function))
  })

  it('should register onPostStop extension on register', async () => {
    await pollutantAlertScheduler.plugin.register(server)
    expect(server.ext).toHaveBeenCalledWith('onPostStop', expect.any(Function))
  })

  it('should run processPollutantAlerts immediately on start', async () => {
    await pollutantAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    expect(mockProcessPollutantAlerts).toHaveBeenCalledWith(server.db)
  })

  it('should schedule cron job with configured schedule on start', async () => {
    await pollutantAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    expect(mockSchedule).toHaveBeenCalledWith(
      '*/30 * * * *',
      expect.any(Function)
    )
  })

  it('should catch and log startup run errors without throwing', async () => {
    mockProcessPollutantAlerts.mockRejectedValueOnce(
      new Error('Startup fetch failed')
    )

    await pollutantAlertScheduler.plugin.register(server)
    await expect(eventHandlers.start()).resolves.not.toThrow()
  })

  it('should call processPollutantAlerts when cron job fires', async () => {
    let capturedCronCallback
    mockSchedule.mockImplementation((_expr, callback) => {
      capturedCronCallback = callback
      return mockCronJob
    })

    await pollutantAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    mockProcessPollutantAlerts.mockClear()
    await capturedCronCallback()

    expect(mockProcessPollutantAlerts).toHaveBeenCalledWith(server.db)
  })

  it('should rethrow cron job errors', async () => {
    const cronError = new Error('DB unavailable')
    let capturedCronCallback
    mockSchedule.mockImplementation((_expr, callback) => {
      capturedCronCallback = callback
      return mockCronJob
    })

    await pollutantAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    mockProcessPollutantAlerts.mockRejectedValueOnce(cronError)
    await expect(capturedCronCallback()).rejects.toThrow('DB unavailable')
  })

  it('should wrap non-Error thrown in cron callback into an Error', async () => {
    let capturedCronCallback
    mockSchedule.mockImplementation((_expr, callback) => {
      capturedCronCallback = callback
      return mockCronJob
    })

    await pollutantAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    mockProcessPollutantAlerts.mockRejectedValueOnce('plain string error')
    await expect(capturedCronCallback()).rejects.toThrow('plain string error')
  })

  it('should stop cron job on onPostStop', async () => {
    await pollutantAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    extHandlers.onPostStop()

    expect(mockCronJob.stop).toHaveBeenCalled()
  })

  it('should not stop cron job on onPostStop if start never fired', async () => {
    await pollutantAlertScheduler.plugin.register(server)

    // onPostStop without start — no cron job set up yet
    extHandlers.onPostStop()

    expect(mockCronJob.stop).not.toHaveBeenCalled()
  })

  it('should throw and log when server.events.on throws an Error', async () => {
    server.events.on.mockImplementation(() => {
      throw new Error('Registration failed')
    })

    await expect(
      pollutantAlertScheduler.plugin.register(server)
    ).rejects.toThrow('Registration failed')
  })

  it('should wrap and rethrow non-Error thrown during register', async () => {
    server.events.on.mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error'
    })

    await expect(
      pollutantAlertScheduler.plugin.register(server)
    ).rejects.toThrow('string error')
  })
})
