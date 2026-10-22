import { randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  type AcceptIntent,
  type InvitationAdmission,
  type InvitationInspectResponse,
  InviteErrorCode,
  type RequestPrincipal,
} from '@amcore/shared'

import { AppException } from '../../common/exceptions/index.js'
import type { OrgInvite, Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/index.js'
import type { BrowserFrontendContext } from '../frontend-context/frontend-placement.js'
import { assertTokenFrontend } from '../frontend-context/frontend-token.js'

import { checkAdministratorRecipient } from './administrator-settlement.js'
import {
  type InvitationCredential,
  invitationCredentialHint,
  invitationSecretHash,
} from './invitation-credential.js'
import { InvitationLiveSessionService } from './invitation-live-session.service.js'
import {
  invalidInvitation,
  invitationClock,
  lockInvitation,
  lockInvitationOrg,
  lockInvitationUser,
} from './invitation-locks.js'
import { currentInvitationIntent, type IntentRole } from './invitation-role-intent.js'
import { invitationTransaction } from './invitation-transaction.js'

@Injectable()
export class InvitationContinuationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liveSession: InvitationLiveSessionService
  ) {}

  async assertFrontend(
    credential: InvitationCredential,
    frontend?: BrowserFrontendContext
  ): Promise<void> {
    if (!frontend) return
    const hint = await this.prisma.$transaction((tx) => invitationCredentialHint(tx, credential))
    assertTokenFrontend(hint.invite, frontend)
  }

  admit(token: string): Promise<InvitationAdmission> {
    return invitationTransaction(this.prisma, async (tx) => {
      const { invite, expiresAt } = await this.lockValid(tx, { token })
      const now = await invitationClock(tx)
      const expiry = new Date(Math.min(expiresAt.getTime(), now.getTime() + 30 * 60_000))
      const credential = randomBytes(32).toString('base64url')
      await tx.invitationContinuation.create({
        data: {
          credentialHash: invitationSecretHash(credential),
          inviteId: invite.id,
          generation: invite.generation,
          expiresAt: expiry,
        },
      })
      return {
        credential,
        expiresAt: expiry.toISOString(),
        intent: {
          expectedInviteId: invite.id,
          expectedGeneration: invite.generation,
        },
      }
    })
  }

  context(credential: string): Promise<{ email: string; expiresAt: string }> {
    return invitationTransaction(this.prisma, async (tx) => {
      const { invite, expiresAt } = await this.lockValid(tx, { continuation: credential })
      return { email: invite.email, expiresAt: expiresAt.toISOString() }
    })
  }

  inspect(
    credential: InvitationCredential,
    principal: RequestPrincipal
  ): Promise<InvitationInspectResponse> {
    return invitationTransaction(this.prisma, async (tx) => {
      const user = await lockInvitationUser(tx, principal.sub)
      await this.liveSession.assert(principal, tx)
      const { invite, roles, expiresAt } = await this.lockValid(tx, credential)
      if (!user || user.emailCanonical !== invite.emailCanonical)
        throw new AppException(
          'Invitation is unavailable for this account',
          400,
          InviteErrorCode.INVITE_ACCOUNT_MISMATCH
        )
      if (!user.emailVerified) return { state: 'verify_email', email: user.emailCanonical }
      const organization = await tx.organization.findUnique({
        where: { id: invite.organizationId },
        select: { id: true, name: true },
      })
      if (!organization) throw invalidInvitation()
      const member = await tx.orgMember.findUnique({
        where: {
          userId_organizationId: { userId: user.id, organizationId: invite.organizationId },
        },
        select: { id: true },
      })
      const provisioning = await checkAdministratorRecipient(
        tx,
        invite.organizationId,
        invite.id,
        invite.generation,
        user.id,
        roles.map((role) => role.id)
      )
      const descriptor = { inviteId: invite.id, generation: invite.generation, organization }
      return member && !provisioning
        ? { state: 'already_access', ...descriptor }
        : {
            state: 'ready',
            ...descriptor,
            roles: roles.map(({ id, name, description }) => ({ id, name, description })),
            expiresAt: expiresAt.toISOString(),
          }
    })
  }

  /** Only validated server OAuth state can use this descriptor as authority. */
  async lockOAuthIntent(
    tx: Prisma.TransactionClient,
    intent: AcceptIntent,
    continuationExpiresAt: string
  ): Promise<OrgInvite> {
    const hint = await tx.orgInvite.findUnique({
      where: { id: intent.expectedInviteId },
      select: { organizationId: true },
    })
    if (!hint) throw invalidInvitation()
    await lockInvitationOrg(tx, hint.organizationId, true)
    await currentInvitationIntent(tx, intent.expectedInviteId, hint.organizationId, true)
    const invite = await lockInvitation(tx, intent.expectedInviteId, hint.organizationId)
    const now = await invitationClock(tx)
    const deadline = new Date(continuationExpiresAt)
    if (
      !invite ||
      invite.generation !== intent.expectedGeneration ||
      invite.intentInvalid ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt <= now ||
      !Number.isFinite(deadline.getTime()) ||
      deadline <= now
    )
      throw invalidInvitation()
    return invite
  }

  /** Caller supplies user-first locks when creating or authenticating an account. */
  async lockValid(
    tx: Prisma.TransactionClient,
    credential: InvitationCredential
  ): Promise<{ invite: OrgInvite; roles: IntentRole[]; expiresAt: Date }> {
    const hint = await invitationCredentialHint(tx, credential)
    await lockInvitationOrg(tx, hint.invite.organizationId, true)
    const roles = await currentInvitationIntent(
      tx,
      hint.invite.id,
      hint.invite.organizationId,
      true
    )
    const invite = await lockInvitation(tx, hint.invite.id, hint.invite.organizationId)
    const now = await invitationClock(tx)
    if (
      !invite ||
      invite.intentInvalid ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.generation !== hint.generation ||
      invite.tokenHash !== hint.invite.tokenHash ||
      invite.expiresAt <= now ||
      hint.expiresAt <= now
    )
      throw invalidInvitation()
    return {
      invite,
      roles,
      expiresAt: new Date(Math.min(invite.expiresAt.getTime(), hint.expiresAt.getTime())),
    }
  }
}
