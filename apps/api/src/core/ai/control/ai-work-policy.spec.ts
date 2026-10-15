import { aiRunBasicCapability, aiRunWorkState } from './ai-work-policy'

import type { AiRun } from '@/generated/prisma/client'

const now = new Date('2026-10-15T12:00:00.000Z')
const run = (changes: Partial<AiRun> = {}) =>
  ({
    status: 'QUEUED',
    retryOfRunId: null,
    assistantBindingCaptured: true,
    inputMessageId: 'input',
    inputFingerprint: 'v1:test',
    deadlineAt: new Date('2026-10-16T12:00:00.000Z'),
    finishedAt: null,
    leaseEpoch: 0,
    attemptCount: 0,
    nextAttemptAt: null,
    availableAt: now,
    ...changes,
  }) as AiRun

describe('AI durable work policy', () => {
  it('keeps only future retry schedules in the delayed bucket', () => {
    expect(aiRunWorkState(run({ nextAttemptAt: new Date(now.getTime() - 1) }), now)).toBe('waiting')
    expect(aiRunWorkState(run({ nextAttemptAt: new Date(now.getTime() + 1) }), now)).toBe('delayed')
    expect(aiRunWorkState(run({ availableAt: new Date(now.getTime() + 1) }), now)).toBe('delayed')
  })

  it('refuses child retry and unproved legacy input', () => {
    const failed = { status: 'FAILED' as const, terminalReasonCode: 'attempts_exhausted' }
    expect(aiRunBasicCapability(run({ ...failed, retryOfRunId: 'source' }), 'retry', now)).toBe(
      'MANUAL_GRANT_SPENT'
    )
    expect(
      aiRunBasicCapability(run({ ...failed, assistantBindingCaptured: false }), 'retry', now)
    ).toBe('LEGACY_MIGRATION_REQUIRED')
  })

  it('limits cleanup to old terminal runs without execution', () => {
    const old = new Date(now.getTime() - 31 * 86400000)
    expect(
      aiRunBasicCapability(run({ status: 'CANCELLED', finishedAt: old }), 'cleanup', now)
    ).toBeNull()
    expect(aiRunBasicCapability(run({ status: 'EXPIRED', finishedAt: now }), 'cleanup', now)).toBe(
      'COOLDOWN'
    )
    expect(
      aiRunBasicCapability(
        run({ status: 'CANCELLED', finishedAt: old, leaseEpoch: 1 }),
        'cleanup',
        now
      )
    ).toBe('RELATED_JOB')
    expect(aiRunBasicCapability(run({ status: 'FAILED', finishedAt: old }), 'cleanup', now)).toBe(
      'RELATED_JOB'
    )
  })
})
