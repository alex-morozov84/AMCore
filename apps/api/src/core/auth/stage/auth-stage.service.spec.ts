import { HttpException } from '@nestjs/common'
import { ClientClosedError, SimpleError } from '@redis/client'

import { BoundedRedisError } from '../../../infrastructure/redis/bounded-redis.js'

import {
  assertStageAlive,
  AUTH_STAGE_CAP,
  AUTH_STAGE_MS,
  AuthStageService,
  nestedDeadlineMs,
} from './auth-stage.service.js'

const deferred = <T = void>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const statusOf = async (promise: Promise<unknown>): Promise<number | undefined> => {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : -1
  }
}

describe('AuthStageService', () => {
  let stage: AuthStageService

  beforeEach(() => {
    jest.useFakeTimers()
    stage = new AuthStageService()
  })
  afterEach(() => jest.useRealTimers())

  it('returns the result of work that settles inside the budget', async () => {
    await expect(stage.run(async () => 'ok')).resolves.toBe('ok')
    expect(stage.heldCount()).toBe(0)
  })

  it('returns 503 at expiry, ignores late completion and keeps the slot until it settles', async () => {
    const work = deferred<string>()
    const lateEffect = jest.fn()
    const outcome = stage.run(async (budget) => {
      const value = await work.promise
      budget.assertAlive()
      lateEffect()
      return value
    })
    const status = statusOf(outcome)
    await jest.advanceTimersByTimeAsync(AUTH_STAGE_MS + 1)
    await expect(status).resolves.toBe(503)
    // Abandoned but unsettled: still counted.
    expect(stage.heldCount()).toBe(1)
    work.resolve('late')
    await jest.advanceTimersByTimeAsync(0)
    expect(lateEffect).not.toHaveBeenCalled()
    expect(stage.heldCount()).toBe(0)
  })

  it('refuses a stage above the cap before any work starts', async () => {
    const gates = Array.from({ length: AUTH_STAGE_CAP }, () => deferred())
    const held = gates.map((gate) => stage.run(() => gate.promise))
    const work = jest.fn(async () => 'never')
    await expect(statusOf(stage.run(work))).resolves.toBe(503)
    expect(work).not.toHaveBeenCalled()
    gates.forEach((gate) => gate.resolve())
    await Promise.all(held)
    expect(stage.heldCount()).toBe(0)
  })

  it('reserves slots synchronously so a burst cannot exceed the cap', async () => {
    const gates = Array.from({ length: AUTH_STAGE_CAP + 10 }, () => deferred())
    const calls = gates.map((gate) => stage.run(() => gate.promise))
    const settled = await Promise.all(calls.slice(AUTH_STAGE_CAP).map((call) => statusOf(call)))
    expect(settled.every((status) => status === 503)).toBe(true)
    gates.forEach((gate) => gate.resolve())
    await Promise.allSettled(calls)
  })

  it.each([
    ['transport', () => new ClientClosedError()],
    ['bounded deadline', () => new BoundedRedisError('deadline', 'unknown')],
    ['operational reply', () => new SimpleError('BUSY script running')],
  ])('maps a Redis %s failure to 503', async (_name, make) => {
    await expect(
      statusOf(
        stage.run(async () => {
          throw make()
        })
      )
    ).resolves.toBe(503)
  })

  it.each([
    ['TypeError', () => new TypeError('bug')],
    ['WRONGTYPE', () => new SimpleError('WRONGTYPE bad key')],
    ['plain error', () => new Error('boom')],
  ])('keeps a %s unchanged', async (_name, make) => {
    const error = make()
    await expect(
      stage.run(async () => {
        throw error
      })
    ).rejects.toBe(error)
  })

  it('passes a genuine decision error through unchanged', async () => {
    const denied = new HttpException('denied', 403)
    await expect(
      stage.run(async () => {
        throw denied
      })
    ).rejects.toBe(denied)
  })

  describe('nested deadlines', () => {
    it('applies the cap unchanged outside a stage', () => {
      expect(nestedDeadlineMs(250)).toBe(250)
      expect(() => assertStageAlive()).not.toThrow()
    })

    it('keeps the cap while plenty of the stage is left and shortens it near the end', async () => {
      const seen: number[] = []
      await stage.run(async () => {
        seen.push(nestedDeadlineMs(250))
        jest.advanceTimersByTime(AUTH_STAGE_MS - 100)
        seen.push(nestedDeadlineMs(250))
      })
      expect(seen[0]).toBe(250)
      expect(seen[1]).toBeLessThanOrEqual(100)
      expect(seen[1]).toBeGreaterThanOrEqual(1)
    })

    it('refuses to start more work once the stage expired', async () => {
      const gate = deferred()
      let lateAttempt: unknown
      const outcome = stage.run(async () => {
        await gate.promise
        try {
          nestedDeadlineMs(250)
        } catch (error) {
          lateAttempt = error
        }
      })
      const status = statusOf(outcome)
      await jest.advanceTimersByTimeAsync(AUTH_STAGE_MS + 1)
      await status
      gate.resolve()
      await jest.advanceTimersByTimeAsync(0)
      expect(lateAttempt).toBeInstanceOf(HttpException)
    })
  })

  it('assertAlive fails after expiry even if the clock has not moved', async () => {
    let captured!: Parameters<Parameters<AuthStageService['run']>[0]>[0]
    const gate = deferred()
    const outcome = stage.run(async (budget) => {
      captured = budget
      await gate.promise
    })
    const status = statusOf(outcome)
    await jest.advanceTimersByTimeAsync(AUTH_STAGE_MS + 1)
    await status
    expect(() => captured.assertAlive()).toThrow()
    gate.resolve()
  })
})
