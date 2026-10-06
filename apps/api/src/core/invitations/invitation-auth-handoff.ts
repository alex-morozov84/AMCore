import { timingSafeEqual } from 'node:crypto'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'

import { invitationSecretHash } from './invitation-credential'

import type { Prisma } from '@/generated/prisma/client'

export interface InvitationHandoffProof {
  attemptId: string
  cleanupKeyHash: string
}

/** Paired server opt-in: no partial headers and no arbitrary attempt grammar. */
export function invitationHandoffProof(
  attempt: unknown,
  key: unknown
): InvitationHandoffProof | undefined {
  if (attempt === undefined && key === undefined) return undefined
  if (
    typeof attempt !== 'string' ||
    !/^[A-Za-z0-9_-]{22}$/.test(attempt) ||
    typeof key !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(key)
  )
    throw new AppException(
      'Invalid authentication handoff proof',
      401,
      AuthErrorCode.AUTH_HANDOFF_INVALID
    )
  return { attemptId: attempt, cleanupKeyHash: invitationSecretHash(key) }
}
export function equalHandoffKey(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Reserve the auth attempt before user/email/organization locks or account writes. */
export async function lockInvitationAuthAttempt(
  tx: Prisma.TransactionClient,
  proof: InvitationHandoffProof
): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2000ms'`
  const key = `invitation-auth-attempt:${proof.attemptId}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)::bigint)`
  if (await tx.invitationAuthHandoff.findUnique({ where: { attemptId: proof.attemptId } }))
    throw new AppException(
      'Authentication attempt already issued',
      409,
      AuthErrorCode.AUTH_HANDOFF_ALREADY_STARTED
    )
}
