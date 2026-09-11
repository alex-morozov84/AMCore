import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteProgressController } from './route-progress-controller'

const OPTS = { revealDelayMs: 100, maxDurationMs: 1000, completingMs: 50 }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createRouteProgressController', () => {
  it('starts idle', () => {
    const controller = createRouteProgressController(OPTS)
    expect(controller.getPhase()).toBe('idle')
  })

  it('does not become visible before the reveal delay elapses', () => {
    const controller = createRouteProgressController(OPTS)
    controller.start()
    expect(controller.getPhase()).toBe('delaying')
    vi.advanceTimersByTime(99)
    expect(controller.getPhase()).toBe('delaying')
  })

  it('becomes visible once the reveal delay elapses', () => {
    const controller = createRouteProgressController(OPTS)
    controller.start()
    vi.advanceTimersByTime(100)
    expect(controller.getPhase()).toBe('visible')
  })

  it('a fast finish before the reveal delay never shows the bar', () => {
    const controller = createRouteProgressController(OPTS)
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.start()
    controller.finish()
    expect(controller.getPhase()).toBe('idle')
    vi.advanceTimersByTime(200)
    expect(controller.getPhase()).toBe('idle')
    // Only the synchronous delaying->idle transitions notified, never visible.
    expect(listener.mock.calls.length).toBeGreaterThan(0)
  })

  it('finishing while visible moves to completing, then idle after completingMs', () => {
    const controller = createRouteProgressController(OPTS)
    controller.start()
    vi.advanceTimersByTime(100) // -> visible
    controller.finish()
    expect(controller.getPhase()).toBe('completing')
    vi.advanceTimersByTime(49)
    expect(controller.getPhase()).toBe('completing')
    vi.advanceTimersByTime(1)
    expect(controller.getPhase()).toBe('idle')
  })

  it('force-completes a navigation that never finishes, after maxDurationMs', () => {
    const controller = createRouteProgressController(OPTS)
    controller.start()
    vi.advanceTimersByTime(100) // -> visible
    vi.advanceTimersByTime(1000) // maxDurationMs elapses with no finish()
    expect(controller.getPhase()).toBe('completing')
    vi.advanceTimersByTime(50)
    expect(controller.getPhase()).toBe('idle')
  })

  it('coalesces a second start() while delaying: no extra reveal-delay restart', () => {
    const controller = createRouteProgressController(OPTS)
    controller.start()
    vi.advanceTimersByTime(60)
    controller.start() // rapid second navigation before the first revealed
    vi.advanceTimersByTime(40) // total 100ms since the first start()
    expect(controller.getPhase()).toBe('visible')
  })

  it('coalesces a second start() while visible: stays visible, does not re-delay', () => {
    const controller = createRouteProgressController(OPTS)
    controller.start()
    vi.advanceTimersByTime(100) // -> visible
    controller.start()
    expect(controller.getPhase()).toBe('visible')
  })

  it('a start() during completing skips the reveal delay and goes straight to visible', () => {
    const controller = createRouteProgressController(OPTS)
    controller.start()
    vi.advanceTimersByTime(100) // -> visible
    controller.finish() // -> completing
    expect(controller.getPhase()).toBe('completing')
    controller.start()
    expect(controller.getPhase()).toBe('visible')
  })

  it('finish() while idle or completing is a no-op', () => {
    const controller = createRouteProgressController(OPTS)
    controller.finish()
    expect(controller.getPhase()).toBe('idle')

    controller.start()
    vi.advanceTimersByTime(100)
    controller.finish() // -> completing
    controller.finish() // no-op, still completing
    expect(controller.getPhase()).toBe('completing')
  })

  it('dispose() clears timers, resets to idle, and notifies mounted UI', () => {
    const controller = createRouteProgressController(OPTS)
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.start()
    listener.mockClear()
    controller.dispose()
    expect(controller.getPhase()).toBe('idle')
    expect(listener).toHaveBeenCalledTimes(1)
    listener.mockClear()
    vi.advanceTimersByTime(1000)
    expect(listener).not.toHaveBeenCalled()
  })

  it('subscribe returns an unsubscribe function that stops further notifications', () => {
    const controller = createRouteProgressController(OPTS)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    unsubscribe()
    controller.start()
    vi.advanceTimersByTime(100)
    expect(listener).not.toHaveBeenCalled()
  })
})
