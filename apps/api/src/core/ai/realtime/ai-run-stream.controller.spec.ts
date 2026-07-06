import { HttpStatus } from '@nestjs/common'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import {
  AppException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '../../../common/exceptions'
import type { AiRunService } from '../runs/ai-run.service'

import { AiRunStreamController } from './ai-run-stream.controller'

describe('AiRunStreamController', () => {
  const CAP_MS = 3_600_000
  const nowSeconds = (): number => Math.floor(Date.now() / 1000)

  let connection: { open: jest.Mock; close: jest.Mock }
  let hub: { register: jest.Mock }
  let runs: { getOwned: jest.Mock }
  let metrics: { incAiRunRealtimeEvent: jest.Mock }
  let env: { get: jest.Mock }
  let logger: { setContext: jest.Mock; warn: jest.Mock }
  let res: { once: jest.Mock; writeHead: jest.Mock; end: jest.Mock; headersSent: boolean }
  let closeListener: (() => void) | undefined
  let controller: AiRunStreamController

  const principal = (overrides: Partial<RequestPrincipal> = {}): RequestPrincipal => ({
    type: 'jwt',
    sub: 'user-1',
    systemRole: SystemRole.User,
    exp: nowSeconds() + 900,
    ...overrides,
  })

  const call = (p: RequestPrincipal, runId = 'run-1'): Promise<void> =>
    controller.stream(p, runId, res as unknown as Parameters<AiRunStreamController['stream']>[2])

  beforeEach(() => {
    closeListener = undefined
    res = {
      once: jest.fn((event: string, cb: () => void) => {
        if (event === 'close') closeListener = cb
      }),
      writeHead: jest.fn(() => {
        res.headersSent = true
      }),
      end: jest.fn(),
      headersSent: false,
    }
    connection = { open: jest.fn(), close: jest.fn(() => res.end()) }
    hub = { register: jest.fn(() => ({ ok: true, connection })) }
    runs = { getOwned: jest.fn().mockResolvedValue({ id: 'run-1' }) }
    metrics = { incAiRunRealtimeEvent: jest.fn() }
    env = { get: jest.fn(() => CAP_MS) }
    logger = { setContext: jest.fn(), warn: jest.fn() }
    controller = new AiRunStreamController(
      runs as unknown as AiRunService,
      hub as never,
      env as never,
      metrics as never,
      logger as never
    )
  })

  describe('ownership', () => {
    it('verifies run ownership before admission and rejects a non-owned/missing run with 404', async () => {
      runs.getOwned.mockRejectedValue(new NotFoundException('Ai run', 'run-1'))
      await expect(call(principal())).rejects.toBeInstanceOf(NotFoundException)
      expect(hub.register).not.toHaveBeenCalled()
      expect(res.writeHead).not.toHaveBeenCalled()
    })

    it('checks ownership before registering (no stream for an unauthorized run)', async () => {
      await call(principal())
      const owned = runs.getOwned.mock.invocationCallOrder[0] as number
      const registered = hub.register.mock.invocationCallOrder[0] as number
      expect(owned).toBeLessThan(registered)
      expect(runs.getOwned).toHaveBeenCalledWith('user-1', 'run-1')
    })
  })

  describe('fail-closed expiry', () => {
    it.each<[string, number | undefined]>([
      ['missing', undefined],
      ['non-integer', nowSeconds() + 1.5],
      ['past', nowSeconds() - 5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects a %s exp with 401 and never admits', async (_label, exp) => {
      await expect(call(principal({ exp }))).rejects.toBeInstanceOf(UnauthorizedException)
      expect(hub.register).not.toHaveBeenCalled()
      expect(res.writeHead).not.toHaveBeenCalled()
    })
  })

  it('caps the stream lifetime at the configured maximum for a far-future token', async () => {
    await call(principal({ exp: nowSeconds() + 10 * 3600 }))
    expect(hub.register).toHaveBeenCalledWith(res, 'user-1', 'run-1', CAP_MS)
  })

  it('uses the remaining token lifetime when it is below the cap', async () => {
    await call(principal({ exp: nowSeconds() + 600 }))
    const lifetime = hub.register.mock.calls[0][3] as number
    expect(lifetime).toBeGreaterThan(0)
    expect(lifetime).toBeLessThanOrEqual(600_000)
  })

  it('admits (register) before flushing headers, and flushes before opening', async () => {
    await call(principal())
    const registered = hub.register.mock.invocationCallOrder[0] as number
    const flushed = res.writeHead.mock.invocationCallOrder[0] as number
    const opened = connection.open.mock.invocationCallOrder[0] as number
    expect(registered).toBeLessThan(flushed)
    expect(flushed).toBeLessThan(opened)
  })

  it('closes the connection on client disconnect', async () => {
    await call(principal())
    expect(closeListener).toBeDefined()
    closeListener?.()
    expect(connection.close).toHaveBeenCalledWith('client')
  })

  it('rejects a global-cap overflow with 503 + metric, without flushing headers', async () => {
    hub.register.mockReturnValue({ ok: false, reason: 'global' })
    await expect(call(principal())).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(metrics.incAiRunRealtimeEvent).toHaveBeenCalledWith('rejected_global')
    expect(res.writeHead).not.toHaveBeenCalled()
  })

  it('rejects a per-user overflow with 429 + metric, without flushing headers', async () => {
    hub.register.mockReturnValue({ ok: false, reason: 'user' })
    let caught: unknown
    try {
      await call(principal())
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppException)
    expect((caught as AppException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(metrics.incAiRunRealtimeEvent).toHaveBeenCalledWith('rejected_user')
    expect(res.writeHead).not.toHaveBeenCalled()
  })

  it('on open() failure after headers are flushed, closes quietly and never rethrows', async () => {
    connection.open.mockImplementation(() => {
      throw new Error('write after ready')
    })
    await expect(call(principal())).resolves.toBeUndefined()
    expect(res.writeHead).toHaveBeenCalledTimes(1)
    expect(res.headersSent).toBe(true)
    expect(connection.close).toHaveBeenCalledWith('client')
    expect(res.end).toHaveBeenCalled()
    expect(metrics.incAiRunRealtimeEvent).toHaveBeenCalledWith('startup_failure')
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
