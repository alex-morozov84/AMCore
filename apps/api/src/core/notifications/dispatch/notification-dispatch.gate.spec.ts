import { mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import { NotificationDispatchGate } from './notification-dispatch.gate'
import { NotificationShutdownLatch } from './notification-shutdown.latch'

describe('NotificationDispatchGate', () => {
  let latch: NotificationShutdownLatch

  beforeEach(() => {
    latch = new NotificationShutdownLatch(mockDeep<PinoLogger>())
  })

  it('grants at most the capacity, atomically, across overlapping reservations', () => {
    const gate = new NotificationDispatchGate(latch, 2)
    // Three entries (wake, cron, direct) reserve "before awaiting anything".
    const grants = [gate.reserve(2), gate.reserve(2), gate.reserve(2)]
    expect(grants).toEqual([2, 0, 0])
    expect(gate.free).toBe(0)
  })

  it('release makes capacity available again and never goes negative', () => {
    const gate = new NotificationDispatchGate(latch, 2)
    gate.reserve(2)
    gate.release(1)
    expect(gate.free).toBe(1)
    gate.release(5)
    expect(gate.free).toBe(2)
  })

  it('grants nothing once the dispatcher is closed', () => {
    const gate = new NotificationDispatchGate(latch, 2)
    latch.close()
    expect(gate.reserve(2)).toBe(0)
  })

  it('remembers one pending rescan request until it is consumed', () => {
    const gate = new NotificationDispatchGate(latch, 1)
    expect(gate.consumeRescan()).toBe(false)
    gate.requestRescan()
    gate.requestRescan()
    expect(gate.consumeRescan()).toBe(true)
    expect(gate.consumeRescan()).toBe(false)
  })
})
