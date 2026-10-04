import type { Pool } from 'pg'

import type { AcceptInviteResponse, RequestPrincipal } from '@amcore/shared'

import type { InvitationActor } from '../../src/core/organizations/invitation-actor'
import type { InviteService } from '../../src/core/organizations/invite.service'
import type { AuditLog, Organization, OrgInvite, Prisma } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/prisma'
import type { E2ETestContext } from '../helpers'

import type { invitationFence } from './invitation-race'

type Fence = ReturnType<typeof invitationFence>
export interface InvitationProofFixture {
  context: E2ETestContext
  prisma: PrismaService
  pool: Pool
  invites: InviteService
  orgId: string
  owner: RequestPrincipal
  recipient: RequestPrincipal
  roleId: string
  actor: () => InvitationActor
  pending: (role?: string | null) => Promise<{ token: string; invite: OrgInvite }>
  accept: (token: string) => Promise<AcceptInviteResponse>
  outcome: (work: Promise<unknown>) => Promise<number>
  claim: () => Fence
  revoked: () => Fence
  truth: (id: string) => Promise<{
    invite: OrgInvite | null
    members: Prisma.OrgMemberGetPayload<{ include: { roles: true } }>[]
    org: Organization | null
    audit: AuditLog[]
  }>
  race: (
    fence: Fence,
    first: () => Promise<unknown>,
    second: () => Promise<unknown>,
    query?: string
  ) => Promise<number[]>
}
