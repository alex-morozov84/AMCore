import { createHash } from 'node:crypto'

import type { AcceptInviteInput, AcceptInviteResponse, RequestPrincipal } from '@amcore/shared'
import { createInvitationOperationId } from '@amcore/shared'

import type { InviteService } from '../../src/core/organizations/invite.service'
import type { Prisma } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/prisma'

/** Fixtures explicitly seed immutable intent; no production legacy-role fallback. */
export async function invitationSeedRole(
  prisma: PrismaService,
  roleId: string | null
): Promise<Pick<Prisma.OrgInviteUncheckedCreateInput, 'intentInvalid' | 'roleIntents'>> {
  const role = roleId
    ? await prisma.role.findUniqueOrThrow({
        where: { id: roleId },
        select: { id: true, name: true },
      })
    : null
  return {
    intentInvalid: !role,
    ...(role
      ? {
          roleIntents: {
            create: {
              ordinal: 0,
              requestedRoleId: role.id,
              liveRoleId: role.id,
              roleNameAtIssue: role.name,
            },
          },
        }
      : {}),
  }
}

export async function invitationAcceptBody(
  prisma: PrismaService,
  token: string
): Promise<Extract<AcceptInviteInput, { token: string }>> {
  const row = await prisma.orgInvite.findUnique({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    select: { id: true, generation: true },
  })
  return {
    token,
    expectedInviteId: row?.id ?? 'invalid-invitation',
    expectedGeneration: row?.generation ?? 1,
  }
}

/** Direct-service proofs still use a real live database session and explicit consent descriptor. */
export async function acceptInvitationForTest(
  invites: InviteService,
  prisma: PrismaService,
  token: string,
  actor: RequestPrincipal,
  ip: string
): Promise<AcceptInviteResponse> {
  if (!actor.sid) {
    const session = await prisma.session.create({
      data: {
        userId: actor.sub,
        familyId: 'invitation-proof',
        refreshToken: createInvitationOperationId(),
        expiresAt: new Date(Date.now() + 3600000),
        lastAuthAt: new Date(),
      },
      select: { id: true },
    })
    actor = { ...actor, sid: session.id }
  }
  const { expectedInviteId, expectedGeneration } = await invitationAcceptBody(prisma, token)
  return invites.acceptInvite(
    { token },
    { expectedInviteId, expectedGeneration },
    createInvitationOperationId(),
    actor,
    ip
  )
}
