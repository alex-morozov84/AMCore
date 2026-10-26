import type { BackgroundEffectEvidence } from '../../generated/prisma/client'

import type { ControlTransaction } from './control-transaction'
import {
  MAX_CLOCK_DRIFT_MS,
  MIN_RECOVERY_WAIT_MS,
  recoverConservativeAttempt,
  type RecoveryClock,
} from './recover-conservative-attempt'

const row = {
  workId: 'work-1',
  incarnation: 'incarnation-1',
  recipeVersion: 2,
  policyVersion: 2,
  activeAttemptId: 'attempt-1',
  outcomeRecorded: false,
} as BackgroundEffectEvidence

/** How the clocks move during one `delay()` call; defaults to an exact, shared advance. */
interface Wake {
  monotonic?: number
  wall?: number
}

function fakeClock(wakes: Wake[] = []) {
  let wall = 1_700_000_000_000
  let monotonic = 500
  const requested: number[] = []
  const clock: RecoveryClock = {
    wallNow: () => wall,
    monotonicNow: () => monotonic,
    delay: async (ms) => {
      const wake = wakes[requested.length] ?? {}
      requested.push(ms)
      monotonic += wake.monotonic ?? ms
      wall += wake.wall ?? wake.monotonic ?? ms
    },
  }
  return { clock, requested, monotonicElapsed: () => monotonic - 500 }
}

function context() {
  const update = jest.fn(async () => undefined)
  const ctx = { tx: { backgroundEffectEvidence: { update } }, now: new Date() }
  return { ctx: ctx as unknown as ControlTransaction, update }
}

const proofs = (...results: boolean[]) => {
  const remaining = [...results]
  return jest.fn(async () => remaining.shift() ?? false)
}

describe('recoverConservativeAttempt', () => {
  it('waits for the positive remainder after a timer wakes early, then updates once', async () => {
    const { clock, requested, monotonicElapsed } = fakeClock([{ monotonic: 1000.4 }])
    const { ctx, update } = context()

    await recoverConservativeAttempt(ctx, row, proofs(true, true), clock)

    expect(requested).toEqual([MIN_RECOVERY_WAIT_MS, 1])
    expect(monotonicElapsed()).toBeGreaterThanOrEqual(MIN_RECOVERY_WAIT_MS)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('keeps the original deadline across several early wakes', async () => {
    const { clock, requested, monotonicElapsed } = fakeClock([
      { monotonic: 1000.1 },
      { monotonic: 0.5 },
    ])
    const { ctx, update } = context()

    await recoverConservativeAttempt(ctx, row, proofs(true, true), clock)

    expect(requested).toEqual([MIN_RECOVERY_WAIT_MS, 1, 1])
    expect(monotonicElapsed()).toBeGreaterThanOrEqual(MIN_RECOVERY_WAIT_MS)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['exactly the bound', MIN_RECOVERY_WAIT_MS],
    ['a late wake', 1500],
  ])('waits once for %s', async (_label, wake) => {
    const { clock, requested } = fakeClock([{ monotonic: wake }])
    const { ctx, update } = context()

    await recoverConservativeAttempt(ctx, row, proofs(true, true), clock)

    expect(requested).toEqual([MIN_RECOVERY_WAIT_MS])
    expect(update).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a forward wall-clock jump', { wall: MIN_RECOVERY_WAIT_MS + MAX_CLOCK_DRIFT_MS + 50 }],
    ['a backward wall-clock jump', { wall: MIN_RECOVERY_WAIT_MS - MAX_CLOCK_DRIFT_MS - 50 }],
  ])('refuses without an update after %s', async (_label, wake) => {
    const { clock } = fakeClock([wake])
    const { ctx, update } = context()

    await expect(recoverConservativeAttempt(ctx, row, proofs(true, true), clock)).rejects.toThrow(
      'OUTCOME_UNRECORDED'
    )

    expect(update).not.toHaveBeenCalled()
  })

  it('detects smaller wall-clock jumps that add up across early wakes', async () => {
    const { clock } = fakeClock([
      { monotonic: 1000.5, wall: 1100.5 },
      { monotonic: 1, wall: 151 },
    ])
    const { ctx, update } = context()

    await expect(recoverConservativeAttempt(ctx, row, proofs(true, true), clock)).rejects.toThrow(
      'OUTCOME_UNRECORDED'
    )

    expect(update).not.toHaveBeenCalled()
  })

  it('does not wait or update when the first owner proof fails', async () => {
    const { clock, requested } = fakeClock()
    const { ctx, update } = context()

    await expect(recoverConservativeAttempt(ctx, row, proofs(false), clock)).rejects.toThrow(
      'OUTCOME_UNRECORDED'
    )

    expect(requested).toEqual([])
    expect(update).not.toHaveBeenCalled()
  })

  it('does not update when the owner proof fails after the wait', async () => {
    const { clock, requested } = fakeClock()
    const { ctx, update } = context()

    await expect(recoverConservativeAttempt(ctx, row, proofs(true, false), clock)).rejects.toThrow(
      'OUTCOME_UNRECORDED'
    )

    expect(requested).toEqual([MIN_RECOVERY_WAIT_MS])
    expect(update).not.toHaveBeenCalled()
  })

  it.each([
    ['another recipe', { recipeVersion: 1 }],
    ['another policy', { policyVersion: 1 }],
    ['no active attempt', { activeAttemptId: null }],
    ['a recorded outcome', { outcomeRecorded: true }],
  ])('refuses %s before any proof or wait', async (_label, change) => {
    const { clock, requested } = fakeClock()
    const { ctx, update } = context()
    const prove = proofs(true, true)

    await expect(
      recoverConservativeAttempt(
        ctx,
        { ...row, ...change } as BackgroundEffectEvidence,
        prove,
        clock
      )
    ).rejects.toThrow('OUTCOME_UNRECORDED')

    expect(requested).toEqual([])
    expect(update).not.toHaveBeenCalled()
  })

  it('keeps the original attempt identity and marks the outcome uncertain', async () => {
    const { clock } = fakeClock([{ monotonic: 1000.4 }])
    const { ctx, update } = context()

    await recoverConservativeAttempt(ctx, row, proofs(true, true), clock)

    expect(update).toHaveBeenCalledWith({
      where: { workId_incarnation: { workId: 'work-1', incarnation: 'incarnation-1' } },
      data: expect.objectContaining({
        activeAttemptId: null,
        outcomeRecorded: true,
        certainty: 'unknown',
        safeResult: expect.objectContaining({ lastAttemptId: 'attempt-1', certainty: 'unknown' }),
      }),
    })
  })
})
