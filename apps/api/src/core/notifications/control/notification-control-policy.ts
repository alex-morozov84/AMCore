import { createHash } from 'node:crypto'

import type { WorkJob, WorkOperation, WorkReason } from '@amcore/shared'

import type { NotificationDelivery } from '../../../generated/prisma/client.js'

export const NOTIFICATION_CONTROL_RETENTION_MS = 30 * 86400000
export const notificationWorkDigest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function deliveryRevision(row: NotificationDelivery): string {
  return notificationWorkDigest([
    row.incarnation,
    row.controlRevision,
    row.status,
    row.attemptCount,
    row.maxAttempts,
    row.manualGrant,
    row.retryableExhaustion,
    row.acceptedSeen,
    row.unresolvedEffectCount,
    row.legacyUnverified,
    row.nextAttemptAt,
    row.terminalAt,
    row.preparedRequestHash,
    row.providerScope,
  ])
}

export function deliveryState(row: NotificationDelivery): WorkJob['state'] {
  if (row.status === 'PENDING') return 'waiting'
  if (row.status === 'PROCESSING') return 'active'
  if (row.status === 'RETRY_SCHEDULED') return 'delayed'
  return row.status === 'FAILED' ? 'failed' : 'completed'
}

export function deliveryCapability(
  row: NotificationDelivery,
  operation: WorkOperation,
  now: Date = new Date()
): WorkReason | null {
  if (operation === 'pause' || operation === 'resume') return 'ACTION_UNAVAILABLE'
  if (operation === 'cancel')
    return ['PENDING', 'RETRY_SCHEDULED'].includes(row.status) ? null : 'ACTIVE_JOB'
  if (row.status === 'PROCESSING') return 'ACTIVE_JOB'
  if (row.unresolvedEffectCount || row.legacyUnverified) return 'EFFECT_UNKNOWN'
  if (operation === 'retry') {
    if (row.acceptedSeen) return 'EFFECT_ACCEPTED'
    if (row.manualGrant !== 'none') return 'MANUAL_GRANT_SPENT'
    if (row.status !== 'FAILED') return 'STATE_CHANGED'
    if (row.terminalReasonCode !== 'attempts_exhausted' || !row.retryableExhaustion)
      return 'PERMANENT_FAILURE'
    if (
      row.requestContractVersion !== 1 ||
      !row.preparedRequest ||
      !row.preparedRequestHash ||
      !row.providerScope
    )
      return 'CONTENT_UNSUPPORTED'
    return null
  }
  if (row.manualGrant === 'reserved') return 'RELATED_JOB'
  if (row.channel === 'in_app') return 'RELATED_JOB'
  if (
    ['DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED'].includes(row.status) &&
    (!row.terminalAt ||
      row.terminalAt.getTime() > now.getTime() - NOTIFICATION_CONTROL_RETENTION_MS)
  )
    return 'COOLDOWN'
  return ['DELIVERED', 'FAILED', 'SKIPPED', 'CANCELLED'].includes(row.status) ? null : 'ACTIVE_JOB'
}
