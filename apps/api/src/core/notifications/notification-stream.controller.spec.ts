import { HttpStatus } from '@nestjs/common'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import {
  AppException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '../../common/exceptions'

import { NotificationStreamController } from './notification-stream.controller'

describe('NotificationStreamController', () => {
  const CAP_MS = 3_600_000
  const nowSeconds = (): number => Math.floor(Date.now() / 1000)

  let connection: { open: jest.Mock; close: jest.Mock }
  let hub: { register: jest.Mock }
  let metrics: { incNotificationRealtimeEvent: jest.Mock }
  let env: { get: jest.Mock }
  let res: { once: jest.Mock; writeHead: jest.Mock }
  let closeListener: (() => void) | undefined
  let controller: NotificationStreamController

  const principal = (overrides: Partial<RequestPrincipal> = {}): RequestPrincipal => ({
    type: 'jwt',
    sub: 'user-1',
    systemRole: SystemRole.User,
    exp: nowSeconds() + 900,
    ...overrides,
  })

  const call = (p: RequestPrincipal): void =>
    controller.stream(p, res as unknown as Parameters<NotificationStreamController['stream']>[1])

  beforeEach(() => {
    connection = { open: jest.fn(), close: jest.fn() }
    hub = { register: jest.fn(() => ({ ok: true, connection })) }
    metrics = { incNotificationRealtimeEvent: jest.fn() }
    env = { get: jest.fn(() => CAP_MS) }
    closeListener = undefined
    res = {
      once: jest.fn((event: string, cb: () => void) => {
        if (event === 'close') closeListener = cb
      }),
      writeHead: jest.fn(),
    }
    controller = new NotificationStreamController(hub as never, env as never, metrics as never)
  })

  describe('fail-closed expiry', () => {
    it.each<[string, number | undefined]>([
      ['missing', undefined],
      ['non-integer', nowSeconds() + 1.5],
      ['past', nowSeconds() - 5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects a %s exp with 401 and never admits', (_label, exp) => {
      expect(() => call(principal({ exp }))).toThrow(UnauthorizedException)
      expect(hub.register).not.toHaveBeenCalled()
      expect(res.writeHead).not.toHaveBeenCalled()
    })
  })

  it('caps the stream lifetime at the configured maximum for a far-future token', () => {
    call(principal({ exp: nowSeconds() + 10 * 3600 })) // 10h ahead, cap is 1h
    expect(hub.register).toHaveBeenCalledWith(res, 'user-1', CAP_MS)
  })

  it('uses the remaining token lifetime when it is below the cap', () => {
    call(principal({ exp: nowSeconds() + 600 })) // 10 min
    const lifetime = hub.register.mock.calls[0][2] as number
    expect(lifetime).toBeGreaterThan(0)
    expect(lifetime).toBeLessThanOrEqual(600_000)
  })

  it('flushes the SSE headers and opens the stream once admitted', () => {
    call(principal())
    expect(res.writeHead).toHaveBeenCalledWith(
      HttpStatus.OK,
      expect.objectContaining({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
    )
    expect(connection.open).toHaveBeenCalledTimes(1)
  })

  it('closes the connection on client disconnect', () => {
    call(principal())
    expect(closeListener).toBeDefined()
    closeListener?.()
    expect(connection.close).toHaveBeenCalledWith('client')
  })

  it('rejects a global-cap overflow with 503 + metric, without flushing headers', () => {
    hub.register.mockReturnValue({ ok: false, reason: 'global' })
    expect(() => call(principal())).toThrow(ServiceUnavailableException)
    expect(metrics.incNotificationRealtimeEvent).toHaveBeenCalledWith('rejected_global')
    expect(res.writeHead).not.toHaveBeenCalled()
  })

  it('rejects a per-user overflow with 429 + metric, without flushing headers', () => {
    hub.register.mockReturnValue({ ok: false, reason: 'user' })
    let caught: unknown
    try {
      call(principal())
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppException)
    expect((caught as AppException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(metrics.incNotificationRealtimeEvent).toHaveBeenCalledWith('rejected_user')
    expect(res.writeHead).not.toHaveBeenCalled()
  })

  it('rolls the registration back if flushing headers throws', () => {
    res.writeHead.mockImplementation(() => {
      throw new Error('socket gone')
    })
    expect(() => call(principal())).toThrow('socket gone')
    expect(connection.close).toHaveBeenCalledWith('client')
  })
})
