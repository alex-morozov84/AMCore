import { jest } from '@jest/globals'

import { parseProviderRetryHint } from '../../src/infrastructure/ai/gateway/providers/provider-retry-hint'
import { AiRunTransitions } from '../../src/infrastructure/ai/runs/ai-run-transitions.service'
import type { E2ETestContext } from '../helpers'

import { consistencyRepository, queuedConsistencyRun } from './ai-consistency-context'
import { until } from './ai-run-controls'

export function retryClockProof(getContext: () => E2ETestContext): void {
  it.each([-604800000, 604800000])(
    'relative floor uses PG clock despite app Date.now skew %i',
    async (skew) => {
      const context = getContext()
      const { run } = await queuedConsistencyRun(context, { deadlineAt: null })
      const [claim] = await consistencyRepository(context).claimDueBatch()
      const before = await context.prisma.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`
      const original = Date.now()
      const clock = jest.spyOn(Date, 'now').mockReturnValue(original + skew)
      try {
        await context.app
          .get(AiRunTransitions)
          .retry(claim!, 'provider_unavailable', parseProviderRetryHint('60'))
      } finally {
        clock.mockRestore()
      }
      const after = await context.prisma.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`
      const row = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
      const floor = row.providerRetryRestriction as { notBefore: string }
      expect(new Date(floor.notBefore).getTime()).toBeGreaterThanOrEqual(
        before[0]!.at.getTime() + 60000
      )
      expect(new Date(floor.notBefore).getTime()).toBeLessThanOrEqual(
        after[0]!.at.getTime() + 60001
      )
    }
  )
  it('lock delay consumes none of the relative wait; fresh settlement clock comes after acquisition', async () => {
    const context = getContext()
    const { run, conversation } = await queuedConsistencyRun(context, { deadlineAt: null })
    const [claim] = await consistencyRepository(context).claimDueBatch()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let acquired!: () => void
    const locked = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const blocker = context.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM ai.ai_conversations WHERE id=${conversation.id} FOR UPDATE`
        acquired()
        await held
      },
      { timeout: 5000 }
    )
    await locked
    const retry = context.app
      .get(AiRunTransitions)
      .retry(claim!, 'provider_unavailable', parseProviderRetryHint('60'))
    let unlock: Date
    try {
      await until(
        async () =>
          (
            await context.prisma.$queryRaw<
              { n: bigint }[]
            >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`
          )[0]!.n > 0n
      )
      unlock = (await context.prisma.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`)[0]!
        .at
    } finally {
      release()
      await blocker
    }
    await retry
    const floor = (await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } }))
      .providerRetryRestriction as { notBefore: string }
    expect(new Date(floor.notBefore).getTime()).toBeGreaterThanOrEqual(unlock!.getTime() + 60000)
  })
  it.each(['earlier', 'equal', 'exhausted'] as const)(
    '%s deadline/retry budget retains the observed floor on terminal outcome',
    async (boundary) => {
      const context = getContext()
      const absolute = new Date(Math.ceil(Date.now() / 1000) * 1000 + 120000)
      const { run } = await queuedConsistencyRun(context, {
        deadlineAt:
          boundary === 'exhausted'
            ? null
            : new Date(absolute.getTime() - (boundary === 'earlier' ? 1000 : 0)),
        maxAttempts: boundary === 'exhausted' ? 1 : 3,
      })
      const [claim] = await consistencyRepository(context).claimDueBatch()
      await context.app
        .get(AiRunTransitions)
        .retry(claim!, 'provider_unavailable', parseProviderRetryHint(absolute.toUTCString()))
      const row = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
      expect(row.status).toBe(boundary === 'exhausted' ? 'FAILED' : 'EXPIRED')
      expect(row.providerRetryRestriction).toMatchObject({
        kind: 'until',
        source: 'http_date',
        notBefore: absolute.toISOString(),
      })
    }
  )
  it('reaper never shortens a retained provider floor or forgets restriction evidence', async () => {
    const context = getContext()
    const { run } = await queuedConsistencyRun(context, { deadlineAt: null })
    const [claim] = await consistencyRepository(context).claimDueBatch()
    const restriction = {
      version: 1,
      kind: 'until',
      observedAt: new Date().toISOString(),
      notBefore: new Date(Date.now() + 120000).toISOString(),
      source: 'relative',
    }
    await context.prisma.aiRunAttempt.update({
      where: { runId_epoch: { runId: run.id, epoch: claim!.epoch } },
      data: { ioStartedAt: new Date() },
    })
    await context.prisma.aiRun.update({
      where: { id: run.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000), providerRetryRestriction: restriction },
    })
    expect(await consistencyRepository(context).reapExpiredLeases()).toMatchObject({
      rescheduled: 1,
    })
    const row = await context.prisma.aiRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(row.providerRetryRestriction).toEqual(restriction)
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(
      new Date(restriction.notBefore).getTime()
    )
    expect(await consistencyRepository(context).claimDueBatch()).toHaveLength(0)
  })
}
