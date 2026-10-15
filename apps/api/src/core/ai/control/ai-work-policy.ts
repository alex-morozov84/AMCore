import { createHash } from 'node:crypto'

import type { WorkJob, WorkOperation, WorkReason } from '@amcore/shared'

import type { AiRun } from '@/generated/prisma/client'

export const AI_CLEANUP_AGE_MS = 30 * 86400000

export function aiWorkDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function aiRunRevision(run: AiRun): string {
  return aiWorkDigest([
    run.incarnation,
    run.controlRevision,
    run.status,
    run.attemptCount,
    run.maxAttempts,
    run.leaseEpoch,
    run.availableAt,
    run.nextAttemptAt,
    run.deadlineAt,
    run.cancellationRequestedAt,
    run.finishedAt,
    run.terminalReasonCode,
    run.retryOfRunId,
  ])
}

export function aiRunWorkState(run: AiRun, now: Date): WorkJob['state'] {
  if (run.status === 'RUNNING') return 'active'
  if (run.status === 'FAILED') return 'failed'
  if (run.status === 'QUEUED')
    return (run.nextAttemptAt && run.nextAttemptAt > now) ||
      (run.availableAt && run.availableAt > now)
      ? 'delayed'
      : 'waiting'
  if (run.status === 'WAITING_APPROVAL' || run.status === 'WAITING_HUMAN') return 'waiting'
  return 'completed'
}

export function aiRunBasicCapability(
  run: AiRun,
  operation: WorkOperation,
  now: Date
): WorkReason | null {
  if (operation === 'pause' || operation === 'resume') return 'ACTION_UNAVAILABLE'
  if (operation === 'cancel')
    return ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'].includes(run.status) ? null : 'STATE_CHANGED'
  if (operation === 'retry') {
    if (run.retryOfRunId) return 'MANUAL_GRANT_SPENT'
    if (run.status !== 'FAILED' || run.terminalReasonCode !== 'attempts_exhausted')
      return 'PERMANENT_FAILURE'
    if (!run.assistantBindingCaptured || !run.inputMessageId || !run.inputFingerprint)
      return 'LEGACY_MIGRATION_REQUIRED'
    if (!run.deadlineAt || run.deadlineAt <= now) return 'HORIZON_EXPIRED'
    return null
  }
  if (!['CANCELLED', 'EXPIRED'].includes(run.status)) return 'RELATED_JOB'
  if (!run.finishedAt || run.finishedAt.getTime() > now.getTime() - AI_CLEANUP_AGE_MS)
    return 'COOLDOWN'
  if (run.leaseEpoch !== 0 || run.attemptCount !== 0 || run.retryOfRunId) return 'RELATED_JOB'
  return null
}
