import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('node-cron', () => ({
  schedule: vi.fn()
}))

vi.mock('../config.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'metOfficeForecast.cronSchedule') return '0 6 * * *'
      return null
    })
  }
}))

vi.mock('../users/utils/forecastAlertProcessor.js', () => ({
  processForecastAlerts: vi.fn()
}))

vi.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('forecast-alert-scheduler', () => {
  let forecastAlertScheduler
  let mockSchedule
  let mockProcessForecastAlerts
  let mockCronJob
  let server
  let eventHandlers
  let extHandlers

  beforeEach(async () => {
    vi.clearAllMocks()

    mockCronJob = { stop: vi.fn() }
    mockSchedule = vi.mocked((await import('node-cron')).schedule)
    mockSchedule.mockReturnValue(mockCronJob)

    mockProcessForecastAlerts = vi.mocked(
      (await import('../users/utils/forecastAlertProcessor.js'))
        .processForecastAlerts
    )
    mockProcessForecastAlerts.mockResolvedValue(undefined)

    eventHandlers = {}
    extHandlers = {}

    server = {
      db: { collection: vi.fn() },
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
    const mod = await import('./forecast-alert-scheduler.js')
    forecastAlertScheduler = mod.forecastAlertScheduler
  })

  it('should have correct plugin name and version', () => {
    expect(forecastAlertScheduler.plugin.name).toBe('forecast-alert-scheduler')
    expect(forecastAlertScheduler.plugin.version).toBe('1.0.0')
  })

  it('should register start event handler on register', async () => {
    await forecastAlertScheduler.plugin.register(server)
    expect(server.events.on).toHaveBeenCalledWith('start', expect.any(Function))
  })

  it('should register onPostStop extension on register', async () => {
    await forecastAlertScheduler.plugin.register(server)
    expect(server.ext).toHaveBeenCalledWith('onPostStop', expect.any(Function))
  })

  it('should run processForecastAlerts immediately on start', async () => {
    await forecastAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    expect(mockProcessForecastAlerts).toHaveBeenCalledWith(server.db)
  })

  it('should schedule cron job with configured schedule on start', async () => {
    await forecastAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    expect(mockSchedule).toHaveBeenCalledWith('0 6 * * *', expect.any(Function))
  })

  it('should catch and log startup run errors without throwing', async () => {
    mockProcessForecastAlerts.mockRejectedValueOnce(
      new Error('Startup fetch failed')
    )

    await forecastAlertScheduler.plugin.register(server)
    await expect(eventHandlers.start()).resolves.not.toThrow()
  })

  it('should call processForecastAlerts when cron job fires', async () => {
    let capturedCronCallback
    mockSchedule.mockImplementation((_expr, callback) => {
      capturedCronCallback = callback
      return mockCronJob
    })

    await forecastAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    mockProcessForecastAlerts.mockClear()
    await capturedCronCallback()

    expect(mockProcessForecastAlerts).toHaveBeenCalledWith(server.db)
  })

  it('should rethrow cron job errors', async () => {
    const cronError = new Error('Forecast API timeout')
    let capturedCronCallback
    mockSchedule.mockImplementation((_expr, callback) => {
      capturedCronCallback = callback
      return mockCronJob
    })

    await forecastAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    mockProcessForecastAlerts.mockRejectedValueOnce(cronError)
    await expect(capturedCronCallback()).rejects.toThrow('Forecast API timeout')
  })

  it('should wrap non-Error thrown in cron callback into an Error', async () => {
    let capturedCronCallback
    mockSchedule.mockImplementation((_expr, callback) => {
      capturedCronCallback = callback
      return mockCronJob
    })

    await forecastAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    mockProcessForecastAlerts.mockRejectedValueOnce('plain string error')
    await expect(capturedCronCallback()).rejects.toThrow('plain string error')
  })

  it('should stop cron job on onPostStop', async () => {
    await forecastAlertScheduler.plugin.register(server)
    await eventHandlers.start()

    extHandlers.onPostStop()

    expect(mockCronJob.stop).toHaveBeenCalled()
  })

  it('should not stop cron job on onPostStop if start never fired', async () => {
    await forecastAlertScheduler.plugin.register(server)

    extHandlers.onPostStop()

    expect(mockCronJob.stop).not.toHaveBeenCalled()
  })

  it('should throw and log when server.events.on throws an Error', async () => {
    server.events.on.mockImplementation(() => {
      throw new Error('Registration failed')
    })

    await expect(
      forecastAlertScheduler.plugin.register(server)
    ).rejects.toThrow('Registration failed')
  })

  it('should wrap and rethrow non-Error thrown during register', async () => {
    server.events.on.mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error'
    })

    await expect(
      forecastAlertScheduler.plugin.register(server)
    ).rejects.toThrow('string error')
  })
})
