import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun, StopCause } from './ai-run-dispatch.types'
import { type AiRunGuard, RunLeaseLostError } from './ai-run-guard.service'
import { AiRunTransitions } from './ai-run-transitions.service'

import { AiRunStepType } from '@/generated/prisma/client'
import type { PrismaService } from '@/prisma'

/**
 * Self-contained run transitions (pre-flight, gateway errors, stop causes): each runs in ONE guarded
 * `record` transaction, and a visible stop cause WINS over the requested transition.
 */
const CLAIM = { id: 'run-1', epoch: 2 } as ClaimedRun
const REFUSAL = {
  reasonCode: 'guardrail_input_blocked',
  checkStepType: AiRunStepType.GUARDRAIL_CHECK,
}

describe('AiRunTransitions', () => {
  let tx: DeepMockProxy<PrismaService>
  let repository: DeepMockProxy<AiRunRepository>
  let guardKind: 'ok' | 'lease_lost' | 'cutoff'
  let stop: StopCause | null
  let transitions: AiRunTransitions
  const logger = { setContext: jest.fn(), warn: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    guardKind = 'ok'
    stop = null
    repository = mockDeep<AiRunRepository>()
    for (const method of [
      'finalizeFailed',
      'finalizeCancelled',
      'finalizeSuperseded',
      'finalizeExpired',
      'finalizeRefusal',
    ] as const) {
      repository[method].mockResolvedValue(true as never)
    }
    repository.finalizeRetry.mockResolvedValue({
      state: 'retry_scheduled',
      nextAttemptAt: new Date(),
    })
    tx = mockDeep<PrismaService>()
    tx.$queryRaw.mockResolvedValue([{ now: new Date(), anchor: new Date() }])
    tx.aiRun.findUniqueOrThrow.mockResolvedValue({ providerRetryRestriction: null } as never)
    tx.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)
    const guard = {
      record: jest.fn(
        async (_c: ClaimedRun, fn: (tx: unknown, ctx: object) => Promise<unknown>) => {
          if (guardKind !== 'ok') return { kind: guardKind }
          try {
            return { kind: 'ok', value: await fn(tx, { stop, epoch: 2 }), stop }
          } catch (error) {
            if (error instanceof RunLeaseLostError) return { kind: 'lease_lost' }
            throw error
          }
        }
      ),
    }
    transitions = new AiRunTransitions(guard as unknown as AiRunGuard, repository, logger as never)
  })

  it.each([
    ['cancelled', 'finalizeCancelled'],
    ['superseded', 'finalizeSuperseded'],
    ['expired', 'finalizeExpired'],
  ] as const)('stop(%s) terminalizes through %s', async (cause, method) => {
    expect(await transitions.stop(CLAIM, cause)).toBe('applied')
    expect(repository[method]).toHaveBeenCalledTimes(1)
  })

  it('failed() writes the failure when no stop cause is visible', async () => {
    expect(await transitions.failed(CLAIM, 'input_missing')).toBe('applied')
    expect(repository.finalizeFailed).toHaveBeenCalledWith(tx, CLAIM, 'input_missing', undefined)
  })

  it.each(['superseded', 'expired'] as const)(
    'a cancel recorded after admission wins over the earlier %s verdict',
    async (earlierCause) => {
      stop = 'cancelled'
      expect(await transitions.stop(CLAIM, earlierCause)).toBe('applied')
      expect(repository.finalizeCancelled).toHaveBeenCalledTimes(1)
      expect(repository.finalizeSuperseded).not.toHaveBeenCalled()
      expect(repository.finalizeExpired).not.toHaveBeenCalled()
    }
  )

  it('a visible stop WINS over a failure, a refusal and a retry (nothing is written over a cancel/takeover)', async () => {
    stop = 'cancelled'

    await transitions.failed(CLAIM, 'input_missing')
    await transitions.refusal(CLAIM, REFUSAL)
    const retry = await transitions.retry(CLAIM, 'provider_timeout')

    expect(repository.finalizeFailed).not.toHaveBeenCalled()
    expect(repository.finalizeRefusal).not.toHaveBeenCalled()
    expect(repository.finalizeRetry).not.toHaveBeenCalled()
    expect(repository.finalizeCancelled).toHaveBeenCalledTimes(3)
    expect(retry).toEqual({ state: 'failed', reasonCode: 'cancelled' })
  })

  it('settleStop uses the visible stop, falling back to the caller abort cause when none is visible', async () => {
    await transitions.settleStop(CLAIM, 'expired')
    expect(repository.finalizeExpired).toHaveBeenCalledTimes(1)

    stop = 'cancelled' // a higher-precedence stop is visible: it wins over the deadline fallback
    await transitions.settleStop(CLAIM, 'expired')
    expect(repository.finalizeCancelled).toHaveBeenCalledTimes(1)
    expect(repository.finalizeExpired).toHaveBeenCalledTimes(1)
  })

  it('refusal() writes the canned refusal when no stop is visible', async () => {
    expect(await transitions.refusal(CLAIM, REFUSAL)).toBe('applied')
    expect(repository.finalizeRefusal).toHaveBeenCalledWith(tx, CLAIM, REFUSAL)
  })

  it('retry() returns the scheduled outcome', async () => {
    expect(await transitions.retry(CLAIM, 'provider_timeout', 5000)).toMatchObject({
      state: 'retry_scheduled',
    })
    expect(repository.finalizeRetry).toHaveBeenCalledWith(
      tx,
      CLAIM,
      'provider_timeout',
      5000,
      expect.objectContaining({ floor: expect.any(Date), refused: false })
    )
  })

  it('a CAS that loses the lease rolls the transaction back and reports lease_lost', async () => {
    repository.finalizeFailed.mockResolvedValue(false)

    expect(await transitions.failed(CLAIM, 'input_missing')).toBe('lease_lost')
    expect(logger.warn).toHaveBeenCalled()
  })

  it.each(['lease_lost', 'cutoff'] as const)(
    'guard %s → nothing written, reported as such',
    async (kind) => {
      guardKind = kind

      expect(await transitions.failed(CLAIM, 'x')).toBe(kind)
      expect(await transitions.retry(CLAIM, 'x')).toEqual({
        state: kind === 'cutoff' ? 'cutoff' : 'lease_lost',
      })
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
    }
  )
})
