import { createHash, randomBytes } from 'node:crypto'

import type { Prisma } from '../../generated/prisma/client.js'

import { type IntentRole,invitationRoleCreate } from './invitation-role-intent.js'

/** Caller owns admission, locks, audit and transaction. Raw token exists only in this result. */
export async function issueInvitation(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    email: string
    emailCanonical: string
    actorId: string
    roles: IntentRole[]
    now: Date
    current?: { id: string; generation: number }
  }
): Promise<{ id: string; generation: number; token: string }> {
  const token = randomBytes(32).toString('base64url')
  const data = {
    tokenHash: createHash('sha256').update(token).digest('hex'),
    issuedAt: input.now,
    expiresAt: new Date(input.now.getTime() + 7 * 86_400_000),
    invitedById: input.actorId,
    roleIntents: { create: invitationRoleCreate(input.roles) },
  }
  if (input.current) {
    await tx.orgInviteRoleIntent.deleteMany({ where: { inviteId: input.current.id } })
    const row = await tx.orgInvite.update({
      where: { id: input.current.id },
      data: {
        ...data,
        generation: input.current.generation + 1,
        issuedAtEstimated: false,
        intentInvalid: false,
      },
      select: { id: true, generation: true },
    })
    return { ...row, token }
  }
  const row = await tx.orgInvite.create({
    data: {
      ...data,
      organizationId: input.organizationId,
      email: input.email,
      emailCanonical: input.emailCanonical,
    },
    select: { id: true, generation: true },
  })
  return { ...row, token }
}
