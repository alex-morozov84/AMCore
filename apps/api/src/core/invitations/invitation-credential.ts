import { createHash } from 'node:crypto'

import { invitationAdmissionResponseSchema, inviteTokenSchema } from '@amcore/shared'

import { invalidInvitation } from './invitation-locks'

import type { OrgInvite, Prisma } from '@/generated/prisma/client'

export type InvitationCredential = { token: string } | { continuation: string }
export const invitationSecretHash = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex')

export async function invitationCredentialHint(
  tx: Prisma.TransactionClient,
  credential: InvitationCredential
): Promise<{ invite: OrgInvite; expiresAt: Date; generation: number }> {
  if ('token' in credential) {
    if (!inviteTokenSchema.safeParse(credential.token).success) throw invalidInvitation()
    const row = await tx.orgInvite.findUnique({
      where: { tokenHash: invitationSecretHash(credential.token) },
    })
    if (!row) throw invalidInvitation()
    return { invite: row, expiresAt: row.expiresAt, generation: row.generation }
  }
  if (
    !invitationAdmissionResponseSchema.shape.credential.safeParse(credential.continuation).success
  )
    throw invalidInvitation()
  const row = await tx.invitationContinuation.findUnique({
    where: { credentialHash: invitationSecretHash(credential.continuation) },
    include: { invite: true },
  })
  if (!row) throw invalidInvitation()
  return { invite: row.invite, expiresAt: row.expiresAt, generation: row.generation }
}
