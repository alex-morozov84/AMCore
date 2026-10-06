import { createHash } from 'node:crypto'

import {
  invitationOperationIdSchema,
  invitationOperationTimestamp,
  InviteErrorCode,
} from '@amcore/shared'

import { AppException } from '../../common/exceptions'

import { invitationClock } from './invitation-locks'

import type { InvitationOperation, Prisma } from '@/generated/prisma/client'

export const INVITATION_RETENTION_MS = 30 * 86_400_000
export function invitationConflict(code: InviteErrorCode): AppException {
  return new AppException('Invitation command conflicts with current state', 409, code)
}
export function parseInvitationOperationId(value: unknown): string {
  const parsed = invitationOperationIdSchema.safeParse(value)
  if (!parsed.success)
    throw new AppException('UUIDv7 operation ID required', 400, 'VALIDATION_ERROR')
  return parsed.data
}
export function invitationFingerprint(intent: Prisma.InputJsonValue): string {
  return createHash('sha256').update(JSON.stringify(intent)).digest('hex')
}
export async function lockInvitationOperation(
  tx: Prisma.TransactionClient,
  actorId: string,
  scope: string,
  operationId: string
): Promise<InvitationOperation | null> {
  parseInvitationOperationId(operationId)
  const key = `invitation-operation:${JSON.stringify([actorId, scope, operationId])}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)::bigint)`
  return tx.invitationOperation.findUnique({
    where: { actorId_scope_operationId: { actorId, scope, operationId } },
  })
}
export async function replayInvitationOperation(
  tx: Prisma.TransactionClient,
  receipt: InvitationOperation | null,
  operationId: string,
  fingerprint: string
): Promise<Prisma.JsonValue | undefined> {
  const now = await invitationClock(tx)
  if (receipt && now.getTime() - receipt.completedAt.getTime() < INVITATION_RETENTION_MS) {
    if (receipt.fingerprint !== fingerprint)
      throw invitationConflict(InviteErrorCode.INVITE_OPERATION_CONFLICT)
    return receipt.result
  }
  const age = now.getTime() - invitationOperationTimestamp(operationId)
  if (age > 86_400_000 || age < -300_000 || receipt)
    throw invitationConflict(InviteErrorCode.INVITE_OPERATION_EXPIRED)
  return undefined
}
export async function completeInvitationOperation(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string
    organizationId?: string
    scope: string
    operationId: string
    kind: string
    intent: Prisma.InputJsonValue
    result: Prisma.InputJsonValue
  }
): Promise<void> {
  await tx.invitationOperation.create({
    data: {
      ...input,
      fingerprint: invitationFingerprint(input.intent),
      completedAt: await invitationClock(tx),
    },
  })
}
