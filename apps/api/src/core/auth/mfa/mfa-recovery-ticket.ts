import type { MfaFlow, Prisma } from '../../../generated/prisma/client.js'

import { mfaHash } from './mfa-secrets.js'

export function recoveryTicketHash(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? mfaHash(JSON.stringify(['mfa-recovery-enrollment-v1', value]))
    : null
}

/** A redeemed ticket remains a narrowly scoped, durable setup authority while the account is emergency-required. */
export async function validRecoverySetup(
  tx: Prisma.TransactionClient,
  flow: MfaFlow,
  now: Date
): Promise<boolean> {
  if (
    flow.authorityKind !== 'recovery_setup' ||
    flow.purpose !== 'initial_setup' ||
    flow.sourceFamilyId !== null ||
    flow.sourceSecurityVersion !== null
  )
    return false
  const ticket = await tx.mfaRecoveryTicket.findUnique({ where: { userId: flow.userId } })
  const account = await tx.mfaAccount.findUnique({ where: { userId: flow.userId } })
  return (
    !!ticket &&
    !!account?.emergencyRequired &&
    account.required &&
    !account.setupComplete &&
    account.securityVersion === flow.securityVersion &&
    ticket.securityVersion === flow.securityVersion &&
    ticket.consumedByFlowId === flow.id &&
    ticket.consumedAt !== null &&
    ticket.consumedAt <= now &&
    ticket.expiresAt > now &&
    flow.expiresAt <= ticket.expiresAt
  )
}

/** Used only behind an exact committed setup transfer after binding advanced the account version. */
export async function recoveryTicketAuthorizedPredecessor(
  tx: Prisma.TransactionClient,
  flow: MfaFlow,
  verifiedAt: Date
): Promise<boolean> {
  if (
    flow.authorityKind !== 'recovery_setup' ||
    flow.purpose !== 'initial_setup' ||
    flow.sourceFamilyId !== null ||
    flow.sourceSecurityVersion !== null
  )
    return false
  const ticket = await tx.mfaRecoveryTicket.findUnique({ where: { userId: flow.userId } })
  return (
    !!ticket &&
    ticket.securityVersion === flow.securityVersion &&
    ticket.consumedByFlowId === flow.id &&
    ticket.consumedAt !== null &&
    ticket.consumedAt >= ticket.createdAt &&
    ticket.consumedAt <= verifiedAt &&
    verifiedAt <= flow.expiresAt &&
    flow.expiresAt <= ticket.expiresAt
  )
}
