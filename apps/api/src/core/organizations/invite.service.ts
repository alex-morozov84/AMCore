import { createHash, randomBytes } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { CreateInviteInput } from '@amcore/shared'
import {
  type AcceptInviteResponse,
  coerceSupportedLocale,
  type InviteListResponse,
  type InviteResponse,
  localizedFrontendUrl,
  type RequestPrincipal,
} from '@amcore/shared'

import { ForbiddenException } from '../../common/exceptions'
import { EnvService } from '../../env/env.service'
import { EmailService } from '../../infrastructure/email'
import { PrismaService } from '../../prisma'
import { AuditLogService } from '../audit'
import { EmailIdentityService } from '../auth/email-identity.service'
import { UserCacheService } from '../auth/user-cache.service'

import { assertInvitationActor, type InvitationActor } from './invitation-actor'
import { InvitationAuthorization } from './invitation-authorization'
import {
  invitationClock,
  lockInvitation,
  lockInvitationOrg,
  lockInvitationRole,
} from './invitation-locks'
import { invitationTransaction } from './invitation-transaction'
import { InviteAcceptService } from './invite-accept.service'
import { InviteRateLimiterService } from './invite-rate-limiter.service'
import { InviteRevokeService } from './invite-revoke.service'
import { getSystemRoleId } from './system-role'

import { AuditActorType, AuditTargetType, Prisma } from '@/generated/prisma/client'

// Bounded starter defaults; changing them requires reviewing abuse and retention budgets.
const INVITE_EXPIRY_DAYS = 7
const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
const INVITE_TOKEN_BYTES = 32

type CreateInviteBranch =
  'noop_already_member' | 'rotated_existing' | 'pending_known_user' | 'pending_new_email'

/**
 * Carried out of the `createInvite` transaction so the post-commit email
 * dispatch needs no second recipient lookup. `recipientLocale` comes from
 * the known user's row (or null for an unknown email — defaulted to `ru`
 * at send time). `hasAccount` drives the email CTA branch.
 */
interface CreateInviteResult {
  branch: CreateInviteBranch
  inviteId: string | null
  rawToken: string | null
  hasAccount: boolean
  recipientLocale: string | null
}

/** Uniform status/body across recipient states; delivery timing is not uniform.
 * Secret-bearing email is sent directly after commit, never queued.
 * Acceptance and revocation own separate locked lifecycle transactions.
 */
@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailIdentity: EmailIdentityService,
    private readonly userCacheService: UserCacheService,
    private readonly inviteRateLimiter: InviteRateLimiterService,
    private readonly emailService: EmailService,
    private readonly env: EnvService,
    private readonly auditLog: AuditLogService,
    private readonly logger: PinoLogger,
    private readonly authorization: InvitationAuthorization,
    private readonly acceptance: InviteAcceptService,
    private readonly revocation: InviteRevokeService
  ) {
    this.logger.setContext(InviteService.name)
  }

  async createInvite(
    orgId: string,
    dto: CreateInviteInput,
    actor: InvitationActor
  ): Promise<InviteResponse> {
    assertInvitationActor(actor)
    const principal = actor.principal
    this.assertOrgContext(principal, orgId)

    const emailCanonical = this.emailIdentity.canonicalize(dto.email)

    // Consume uniformly across recipient outcomes; status/body do not
    // guarantee equal latency or replace the rate limit.
    await this.inviteRateLimiter.check(orgId, emailCanonical, principal.sub)
    await this.inviteRateLimiter.consume(orgId, emailCanonical, principal.sub)

    let roleId = dto.roleId ?? ''
    const emailHash = this.hashEmail(emailCanonical)

    const result: CreateInviteResult = await invitationTransaction(this.prisma, async (tx) => {
      const user = await this.authorization.lockActor(tx, actor)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`org-invite:${orgId}:${emailCanonical}`}, 0)::bigint)`
      await lockInvitationOrg(tx, orgId)
      const key = await this.authorization.authorize(tx, orgId, actor, user)
      roleId = dto.roleId ?? (await getSystemRoleId(tx, 'MEMBER'))
      await lockInvitationRole(tx, roleId, orgId)

      // OA-05: assignability inside the tx so role.organizationId can't
      // change between check and the membership/invite write.

      const targetUser = await tx.user.findUnique({
        where: { emailCanonical },
        select: { id: true, locale: true },
      })

      const hasAccount = targetUser !== null
      const recipientLocale = targetUser?.locale ?? null

      // Branch A: already a member — silent no-op (no row, no email,
      // audit only). Caller observes the same uniform 202; admin can
      // diagnose via audit log if "I invited X and nothing happened".
      if (targetUser) {
        const existingMember = await tx.orgMember.findUnique({
          where: {
            userId_organizationId: { userId: targetUser.id, organizationId: orgId },
          },
          select: { id: true },
        })
        if (existingMember) {
          this.authorization.checkKeyClock(key, await invitationClock(tx))
          await this.auditLog.record(
            {
              action: 'org.invite_created',
              actorId: principal.sub,
              actorType: AuditActorType.USER,
              metadata: {
                actorCredentialType: principal.type,
                branch: 'noop_already_member',
                emailHash,
                pinoEvent: 'org.invite.created',
                roleId: null,
              },
              organizationId: orgId,
              targetType: AuditTargetType.ORG_INVITE,
            },
            { tx }
          )
          return {
            branch: 'noop_already_member' as const,
            inviteId: null,
            rawToken: null,
            hasAccount,
            recipientLocale,
          }
        }
      }

      // Active-row lookup (partial unique scope: not yet accepted nor
      // revoked). At most one such row per (orgId, emailCanonical) —
      // enforced by the partial unique declared in user.prisma. If
      // present, we rotate; otherwise we insert. Expired-pending rows
      // count as active under the constraint and are rotated in place
      // (Stage A invariant — see OrgInvite schema comment).
      let existing = await tx.orgInvite.findFirst({
        where: {
          organizationId: orgId,
          emailCanonical,
          acceptedAt: null,
          revokedAt: null,
        },
        select: { id: true },
      })

      if (existing && !(await lockInvitation(tx, existing.id, orgId))) existing = null
      const now = await invitationClock(tx)
      this.authorization.checkKeyClock(key, now)
      const rawToken = randomBytes(INVITE_TOKEN_BYTES).toString('base64url')
      const tokenHash = this.hashToken(rawToken)
      const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_MS)

      if (existing) {
        await tx.orgInvite.update({
          where: { id: existing.id },
          data: {
            tokenHash,
            expiresAt,
            roleId,
            invitedById: principal.sub,
            email: dto.email,
          },
        })
        await this.auditLog.record(
          {
            action: 'org.invite_created',
            actorId: principal.sub,
            actorType: AuditActorType.USER,
            metadata: {
              actorCredentialType: principal.type,
              branch: 'rotated_existing',
              emailHash,
              pinoEvent: 'org.invite.created',
              roleId,
            },
            organizationId: orgId,
            targetId: existing.id,
            targetType: AuditTargetType.ORG_INVITE,
          },
          { tx }
        )
        return {
          branch: 'rotated_existing' as const,
          inviteId: existing.id,
          rawToken,
          hasAccount,
          recipientLocale,
        }
      }

      const created = await tx.orgInvite.create({
        data: {
          organizationId: orgId,
          emailCanonical,
          email: dto.email,
          roleId,
          invitedById: principal.sub,
          tokenHash,
          expiresAt,
        },
        select: { id: true },
      })

      await this.auditLog.record(
        {
          action: 'org.invite_created',
          actorId: principal.sub,
          actorType: AuditActorType.USER,
          metadata: {
            actorCredentialType: principal.type,
            branch: targetUser ? 'pending_known_user' : 'pending_new_email',
            emailHash,
            pinoEvent: 'org.invite.created',
            roleId,
          },
          organizationId: orgId,
          targetId: created.id,
          targetType: AuditTargetType.ORG_INVITE,
        },
        { tx }
      )

      return {
        branch: (targetUser ? 'pending_known_user' : 'pending_new_email') as CreateInviteBranch,
        inviteId: created.id,
        rawToken,
        hasAccount,
        recipientLocale,
      }
    })

    // Dispatch the invite email AFTER the transaction commits — never
    // inside the tx, or a rolled-back invite could still send a live
    // token. `noop_already_member` has a null rawToken and sends nothing.
    if (result.rawToken !== null) {
      await this.dispatchInviteEmail({
        orgId,
        roleId,
        inviterUserId: principal.sub,
        recipientEmail: dto.email,
        rawToken: result.rawToken,
        hasAccount: result.hasAccount,
        recipientLocale: result.recipientLocale,
      })
    }

    this.logger.info(
      {
        event: 'org.invite.created',
        actorUserId: principal.sub,
        actorCredentialType: principal.type,
        orgId,
        inviteId: result.inviteId,
        emailHash: this.hashEmail(emailCanonical),
        roleId: result.branch === 'noop_already_member' ? null : roleId,
        branch: result.branch,
      },
      'Org invite created'
    )

    return { status: 'invited' }
  }

  async listInvites(
    orgId: string,
    principal: RequestPrincipal,
    page: number,
    limit: number
  ): Promise<InviteListResponse> {
    this.assertOrgContext(principal, orgId)

    const skip = (page - 1) * limit
    const now = new Date()

    // "Active" for the list endpoint additionally excludes expired
    // rows — they exist in the partial-unique bucket only so re-invite
    // can rotate them, but they shouldn't surface in the admin UI as
    // outstanding invitations. The (organizationId, createdAt) index
    // covers the sort + filter prefix; Postgres can use the partial
    // unique as a secondary path if needed.
    const where: Prisma.OrgInviteWhereInput = {
      organizationId: orgId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    }

    const [rows, total] = await Promise.all([
      this.prisma.orgInvite.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          email: true,
          roleId: true,
          invitedById: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      this.prisma.orgInvite.count({ where }),
    ])

    return {
      data: rows.map((r) => ({
        id: r.id,
        email: r.email,
        roleId: r.roleId,
        invitedById: r.invitedById,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    }
  }

  revokeInvite(orgId: string, inviteId: string, actor: InvitationActor): Promise<void> {
    return this.revocation.revoke(orgId, inviteId, actor)
  }

  acceptInvite(
    token: string,
    principal: RequestPrincipal,
    ip: string
  ): Promise<AcceptInviteResponse> {
    return this.acceptance.accept(token, principal, ip)
  }

  private assertOrgContext(principal: RequestPrincipal, orgId: string): void {
    if (principal.organizationId !== orgId) {
      throw new ForbiddenException('Organization context does not match the operation target')
    }
  }

  /**
   * Best-effort post-commit invite email. The invite row is already
   * committed, so a queue/lookup failure must not fail the uniform 202 —
   * it is logged and swallowed (a re-invite rotates the token and
   * re-sends). Org/role are read with explicit selects and fall back
   * softly if they were deleted in the commit→dispatch window. The raw
   * token only ever leaves via `acceptUrl`; it is never logged.
   */
  private async dispatchInviteEmail(args: {
    orgId: string
    roleId: string
    inviterUserId: string
    recipientEmail: string
    rawToken: string
    hasAccount: boolean
    recipientLocale: string | null
  }): Promise<void> {
    try {
      const [org, inviter, role] = await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: args.orgId },
          select: { name: true },
        }),
        this.userCacheService.getUser(args.inviterUserId),
        this.prisma.role.findUnique({ where: { id: args.roleId }, select: { name: true } }),
      ])

      // Fall back to the shared default rather than a hardcoded locale: an
      // unknown recipient (no account yet) has no stored preference. Coerce
      // rather than parse — a locale anomaly must not abort invite dispatch.
      const locale = coerceSupportedLocale(args.recipientLocale)
      const acceptUrl = localizedFrontendUrl(
        this.env.get('FRONTEND_URL'),
        locale,
        'invite/accept',
        {
          token: args.rawToken,
        }
      )

      await this.emailService.sendOrgInviteEmail(args.recipientEmail, {
        orgName: org?.name ?? 'AMCore',
        inviterName: inviter?.name ?? inviter?.email ?? 'AMCore',
        inviterEmail: inviter?.email ?? '',
        roleName: role?.name ?? 'MEMBER',
        hasAccount: args.hasAccount,
        acceptUrl,
        expiresInDays: INVITE_EXPIRY_DAYS,
        locale,
      })
    } catch {
      // Never log the raw token / acceptUrl — only the non-PII email hash.
      this.logger.warn(
        {
          event: 'org.invite.email_dispatch_failed',
          orgId: args.orgId,
          category: 'dispatch_failed',
        },
        'Org invite email dispatch failed (invite row already committed)'
      )
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private hashEmail(emailCanonical: string): string {
    return createHash('sha256').update(emailCanonical).digest('hex')
  }
}
