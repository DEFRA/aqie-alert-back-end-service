import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pollutantAlertScheduler } from './pollutant-alert-scheduler.js'

vi.mock('../config.js', () => ({
  config: {
    get: vi.fn(() => 60000)
  }
}))

const mockProcessPollutantAlerts = vi.fn()

vi.mock('../users/utils/pollutantAlertProcessor.js', () => ({
  processPollutantAlerts: (...args) => mockProcessPollutantAlerts(...args)
}))

describe('pollutant-alert-scheduler', () => {
  let server
  let eventHandlers

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    eventHandlers = {}

    server = {
      db: { collection: vi.fn() },
      logger: {
        info: vi.fn(),
        error: vi.fn()
      },
      events: {
        on: vi.fn((event, handler) => {
          eventHandlers[event] = handler
        })
      }
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should register start and stop event handlers', async () => {
    await pollutantAlertScheduler.plugin.register(server)

    expect(server.events.on).toHaveBeenCalledWith('start', expect.any(Function))
    expect(server.events.on).toHaveBeenCalledWith('stop', expect.any(Function))
  })

  it('should run cycle immediately on start and set interval', async () => {
    mockProcessPollutantAlerts.mockResolvedValue(undefined)

    await pollutantAlertScheduler.plugin.register(server)
    eventHandlers.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(mockProcessPollutantAlerts).toHaveBeenCalledWith(server.db)
    expect(server.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('started with interval')
    )
  })

  it('should run cycle again after interval elapses', async () => {
    mockProcessPollutantAlerts.mockResolvedValue(undefined)

    await pollutantAlertScheduler.plugin.register(server)
    eventHandlers.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(mockProcessPollutantAlerts).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60000)
    expect(mockProcessPollutantAlerts).toHaveBeenCalledTimes(2)
  })

  it('should skip cycle when already running', async () => {
    let resolveFirst
    mockProcessPollutantAlerts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )

    await pollutantAlertScheduler.plugin.register(server)
    eventHandlers.start()

    // First cycle starts but doesn't resolve yet
    await vi.advanceTimersByTimeAsync(0)
    expect(mockProcessPollutantAlerts).toHaveBeenCalledTimes(1)

    // Trigger interval while first is still running
    await vi.advanceTimersByTimeAsync(60000)

    expect(server.logger.info).toHaveBeenCalledWith(
      'Pollutant alert cycle already running, skipping this tick'
    )

    // Resolve first cycle
    resolveFirst()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('should log error when processPollutantAlerts throws', async () => {
    mockProcessPollutantAlerts.mockRejectedValue(
      new Error('DB connection lost')
    )

    await pollutantAlertScheduler.plugin.register(server)
    eventHandlers.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(server.logger.error).toHaveBeenCalledWith(
      'Pollutant alert scheduler error: DB connection lost'
    )
  })

  it('should recover and run next cycle after error', async () => {
    mockProcessPollutantAlerts
      .mockRejectedValueOnce(new Error('Transient error'))
      .mockResolvedValueOnce(undefined)

    await pollutantAlertScheduler.plugin.register(server)
    eventHandlers.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(server.logger.error).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60000)
    expect(mockProcessPollutantAlerts).toHaveBeenCalledTimes(2)
  })

  it('should clear interval and log on stop', async () => {
    mockProcessPollutantAlerts.mockResolvedValue(undefined)

    await pollutantAlertScheduler.plugin.register(server)
    eventHandlers.start()

    await vi.advanceTimersByTimeAsync(0)

    eventHandlers.stop()

    expect(server.logger.info).toHaveBeenCalledWith(
      'Pollutant alert scheduler stopped'
    )

    // After stop, advancing timers should not trigger another cycle
    mockProcessPollutantAlerts.mockClear()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mockProcessPollutantAlerts).not.toHaveBeenCalled()
  })

  it('should not log on stop if never started', async () => {
    await pollutantAlertScheduler.plugin.register(server)
    eventHandlers.stop()

    expect(server.logger.info).not.toHaveBeenCalledWith(
      'Pollutant alert scheduler stopped'
    )
  })

  it('should have correct plugin name and version', () => {
    expect(pollutantAlertScheduler.plugin.name).toBe(
      'pollutant-alert-scheduler'
    )
    expect(pollutantAlertScheduler.plugin.version).toBe('1.0.0')
  })
})
