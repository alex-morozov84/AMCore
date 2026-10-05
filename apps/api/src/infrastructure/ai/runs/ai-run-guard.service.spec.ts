import { mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { ClaimedRun } from './ai-run-dispatch.types'
import { AiRunGuard, RunLeaseLostError } from './ai-run-guard.service'

import { ShutdownLatch } from '@/infrastructure/worker-lifecycle'

/**
 * Unit proofs of the run guard's CONTROL FLOW over a scripted transaction client (the lock/CAS SQL
 * semantics themselves are proven against real Postgres in the AI run e2e suites). Raw queries run in a
 * fixed order inside the guard: `set_config(lock_timeout)` → conversation lock → run lock → fresh-clock
 * lease renewal → optional `ioStartedAt` marker → callback.
 */
const CLAIM: ClaimedRun = {
  id: 'run-1',
  conversationId: 'conv-1',
  modelSnapshot: {},
  epoch: 3,
  attemptNumber: 1,
  maxAttempts: 3,
  deadlineAt: null,
  ownershipGeneration: 2,
  leaseToken: 'lease-a',
}

interface Script {
  /** Conversation fence row; `null` = the conversation is gone. */
  fence?: { ownershipGeneration: number; controlledBy: string; state: string } | null
  /** Rows of the run identity lock; `[]` = the run is not leased by this claim. */
  locked?: { id: string }[]
  /** Rows of the fresh-clock renewal; `[]` = the lease already expired. */
  renewed?: { cancellationRequestedAt: Date | null; deadlinePassed: boolean }[]
}

const FRESH_FENCE = { ownershipGeneration: 2, controlledBy: 'BOT', state: 'ACTIVE' }

describe('AiRunGuard', () => {
  let latch: ShutdownLatch
  let metrics: { incAiRunAdmission: jest.Mock }
  let queries: string[]
  let executed: string[]
  let guard: AiRunGuard

  function build(script: Script, failWith?: unknown): void {
    queries = []
    executed = []
    const responses: unknown[][] = [
      [{}], // set_config(lock_timeout)
      script.fence === undefined ? [FRESH_FENCE] : script.fence === null ? [] : [script.fence],
      script.locked ?? [{ id: 'run-1' }],
      script.renewed ?? [{ cancellationRequestedAt: null, deadlinePassed: false }],
    ]
    const tx = {
      $queryRaw: jest.fn(async (query: { strings: string[] }) => {
        queries.push(query.strings.join('?'))
        if (failWith !== undefined && queries.length === 2) throw failWith
        return responses[queries.length - 1] ?? []
      }),
      $executeRaw: jest.fn(async (query: { strings: string[] }) => {
        executed.push(query.strings.join('?'))
        return 1
      }),
    }
    const prisma = {
      $transaction: jest.fn((callback: (client: unknown) => Promise<unknown>) => callback(tx)),
    }
    guard = new AiRunGuard(
      prisma as never,
      latch,
      metrics as never,
      mockDeep<PinoLogger>() as never
    )
  }

  beforeEach(() => {
    latch = new ShutdownLatch(mockDeep<PinoLogger>(), 'ai.run')
    metrics = { incAiRunAdmission: jest.fn() }
  })

  it('locks conversation → run (by identity, incl. epoch) → fresh-clock renewal, in that order', async () => {
    build({})
    const fn = jest.fn().mockResolvedValue('written')

    const outcome = await guard.admit(CLAIM, fn)

    expect(outcome).toEqual({ kind: 'ok', value: 'written', stop: null })
    expect(queries[0]).toContain('lock_timeout')
    expect(queries[1]).toContain('"ai"."ai_conversations"')
    expect(queries[1]).toContain('FOR UPDATE')
    expect(queries[2]).toContain('"ai"."ai_runs"')
    expect(queries[2]).toContain('"leaseEpoch"')
    expect(queries[2]).toContain('FOR UPDATE')
    expect(queries[3]).toContain('clock_timestamp()')
    expect(queries[3]).toContain('"leaseExpiresAt" > clock_timestamp()')
    // The callback gets a guarded transaction facade (a Proxy): inspect its context by hand.
    expect(fn.mock.calls[0]![1]).toEqual({ stop: null, epoch: 3 })
    expect(metrics.incAiRunAdmission).toHaveBeenCalledWith('admitted')
  })

  it.each([
    [
      'a recorded user cancel',
      { cancellationRequestedAt: new Date(), deadlinePassed: false },
      undefined,
      'cancelled',
    ],
    [
      'a human takeover',
      { cancellationRequestedAt: null, deadlinePassed: false },
      { ownershipGeneration: 3, controlledBy: 'HUMAN', state: 'ACTIVE' },
      'superseded',
    ],
    [
      'a passed deadline',
      { cancellationRequestedAt: null, deadlinePassed: true },
      undefined,
      'expired',
    ],
  ] as const)(
    'admit refuses on %s without running the callback',
    async (_n, renewed, fence, cause) => {
      build({ renewed: [renewed], fence })
      const fn = jest.fn()

      const outcome = await guard.admit(CLAIM, fn)

      expect(outcome).toEqual({ kind: 'stopped', cause })
      expect(fn).not.toHaveBeenCalled()
      expect(metrics.incAiRunAdmission).toHaveBeenCalledWith(cause)
    }
  )

  it('applies the precedence cancelled > superseded > expired when several causes are visible', async () => {
    const takeover = { ownershipGeneration: 9, controlledBy: 'HUMAN', state: 'ACTIVE' }

    build({
      fence: takeover,
      renewed: [{ cancellationRequestedAt: new Date(), deadlinePassed: true }],
    })
    expect(await guard.admit(CLAIM, jest.fn())).toEqual({ kind: 'stopped', cause: 'cancelled' })

    build({ fence: takeover, renewed: [{ cancellationRequestedAt: null, deadlinePassed: true }] })
    expect(await guard.admit(CLAIM, jest.fn())).toEqual({ kind: 'stopped', cause: 'superseded' })
  })

  it('treats a missing conversation as a takeover-class stop (fail closed)', async () => {
    build({ fence: null })

    expect(await guard.admit(CLAIM, jest.fn())).toEqual({ kind: 'stopped', cause: 'superseded' })
  })

  it('record RUNS the callback despite a visible stop and reports it, so a known outcome is never erased', async () => {
    build({ renewed: [{ cancellationRequestedAt: new Date(), deadlinePassed: false }] })
    const fn = jest.fn().mockResolvedValue('recorded')

    const outcome = await guard.record(CLAIM, fn)

    expect(outcome).toEqual({ kind: 'ok', value: 'recorded', stop: 'cancelled' })
    expect(fn.mock.calls[0]![1]).toEqual({ stop: 'cancelled', epoch: 3 })
  })

  it.each([
    ['the run is not leased by this claim (token/epoch/status moved)', { locked: [] }],
    ['the lease already expired (an expired lease is never revived)', { renewed: [] }],
  ])('a stale holder gets lease_lost and writes nothing when %s', async (_name, script) => {
    build(script)
    const fn = jest.fn()

    expect(await guard.record(CLAIM, fn)).toEqual({ kind: 'lease_lost' })
    expect(fn).not.toHaveBeenCalled()
    expect(metrics.incAiRunAdmission).toHaveBeenCalledWith('lease_lost')
  })

  it('a lock wait that hits lock_timeout (55P03) or deadlocks fails closed as lease_lost', async () => {
    build(
      {},
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
    )
    expect(await guard.record(CLAIM, jest.fn())).toEqual({ kind: 'lease_lost' })

    build({}, Object.assign(new Error('deadlock detected'), { code: '40P01' }))
    expect(await guard.admit(CLAIM, jest.fn())).toEqual({ kind: 'lease_lost' })
  })

  it('a lease lost INSIDE the callback (a CAS miss) rolls back as lease_lost', async () => {
    build({})

    const outcome = await guard.record(CLAIM, async () => {
      throw new RunLeaseLostError()
    })

    expect(outcome).toEqual({ kind: 'lease_lost' })
  })

  it('rethrows an unrelated error (a real fault is never swallowed as a lost lease)', async () => {
    build({})

    await expect(
      guard.record(CLAIM, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
  })

  it('markIoStarted stamps the attempt row ("possible start") before the callback', async () => {
    build({})
    const fn = jest.fn(async () => {
      expect(executed.some((sql) => sql.includes('"ioStartedAt"'))).toBe(true)
    })

    await guard.admit(CLAIM, fn, { markIoStarted: true })

    expect(fn).toHaveBeenCalled()
  })

  it('does not stamp ioStartedAt for a refused admission', async () => {
    build({ renewed: [{ cancellationRequestedAt: new Date(), deadlinePassed: false }] })

    await guard.admit(CLAIM, jest.fn(), { markIoStarted: true })

    expect(executed).toHaveLength(0)
  })

  it('a closed dispatcher refuses admission without touching the database, but still lets record finish', async () => {
    build({})
    latch.close()

    expect(await guard.admit(CLAIM, jest.fn())).toEqual({ kind: 'cutoff' })
    expect(queries).toHaveLength(0)
    expect(metrics.incAiRunAdmission).toHaveBeenCalledWith('shutdown')

    expect(await guard.record(CLAIM, jest.fn().mockResolvedValue(1))).toMatchObject({ kind: 'ok' })
  })

  it('a sealed dispatcher starts no transaction at all (cutoff)', async () => {
    build({})
    latch.seal()

    expect(await guard.record(CLAIM, jest.fn())).toEqual({ kind: 'cutoff' })
    expect(queries).toHaveLength(0)
  })
})
