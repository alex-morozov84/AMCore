import { createHash, randomBytes } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import type { CreateInviteInput } from '@amcore/shared'
import {
  type AcceptInviteResponse,
  InviteErrorCode,
  type InviteListResponse,
  type InviteResponse,
  type RequestPrincipal,
} from '@amcore/shared'

import { AppException, ForbiddenException, NotFoundException } from '../../common/exceptions'
import { BusinessRuleViolationException } from '../../common/exceptions/domain/business-rule.exception'
import { EnvService } from '../../env/env.service'
import { EmailService } from '../../infrastructure/email'
import { PrismaService } from '../../prisma'
import { EmailIdentityService } from '../auth/email-identity.service'
import { UserCacheService } from '../auth/user-cache.service'

import { InviteAcceptLimiterService } from './invite-accept-limiter.service'
import { InviteRateLimiterService } from './invite-rate-limiter.service'
import { OrganizationsService } from './organizations.service'
import { RoleAssignabilityService } from './role-assignability.service'

type PrismaTx = Prisma.TransactionClient

// Hardcoded starter constants (tune by code change, not env — see
// ai/SECURITY_AUDIT.md rationale shared with login / api-key limits).
const INVITE_EXPIRY_DAYS = 7
const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
const INVITE_TOKEN_BYTES = 32

type CreateInviteBranch =
  | 'noop_already_member'
  | 'rotated_existing'
  | 'pending_known_user'
  | 'pending_new_email'

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

/**
 * Invite service (OB-02).
 *
 * Implements the pending-invite contract that replaces the previous
 * "user must already exist" flow. The four public methods all return
 * canonical response shapes from `@amcore/shared` so the Stage C
 * controller swap is a pure pass-through — no shape transformation
 * between service and HTTP boundary.
 *
 * `createInvite` is non-enumerating by construction: rate-limit
 * consume + uniform `{status: 'invited'}` response across all four
 * branches (already-member no-op, rotation of an active row, fresh
 * pending for a known user, fresh pending for an unknown email).
 * Status, body, and timing class are invariant to the recipient's
 * platform state.
 *
 * `acceptInvite` collapses every negative decision (token not found /
 * expired / revoked / accepted / email mismatch) to the same
 * `INVITE_INVALID_OR_EXPIRED` error code so the accept side stays
 * non-enumerating for invite-token guesses. `INVITE_EMAIL_NOT_VERIFIED`
 * is the one distinct code — verifying email is a prerequisite the
 * UI surface should surface to legitimate invitees.
 *
 * The `acceptedByUserId` / `revokedById` columns are bound to the
 * authenticated principal; a leaked token alone is never bearer-
 * equivalent (the accept handler is `@Auth(AuthType.Bearer)` and the
 * canonical-email match runs against a fresh user row from
 * `UserCacheService`, not stale JWT claims).
 *
 * Stage D wires email delivery: `createInvite` enqueues an `ORG_INVITE`
 * job carrying the raw token in its `acceptUrl` AFTER the transaction
 * commits (never inside — a rolled-back invite must not send a live
 * token). Dispatch is best-effort: a queue/lookup failure is logged and
 * swallowed so the uniform 202 contract holds (`dispatchInviteEmail`).
 */
@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgsService: OrganizationsService,
    private readonly emailIdentity: EmailIdentityService,
    private readonly roleAssignability: RoleAssignabilityService,
    private readonly userCacheService: UserCacheService,
    private readonly inviteRateLimiter: InviteRateLimiterService,
    private readonly acceptLimiter: InviteAcceptLimiterService,
    private readonly emailService: EmailService,
    private readonly env: EnvService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(InviteService.name)
  }

  async createInvite(
    orgId: string,
    dto: CreateInviteInput,
    principal: RequestPrincipal
  ): Promise<InviteResponse> {
    this.assertOrgContext(principal, orgId)

    const emailCanonical = this.emailIdentity.canonicalize(dto.email)

    // Rate limit on entry — consume after `check` passes, regardless of
    // which branch the request takes. Probing branches by status/timing
    // is already impossible (uniform 202), but consuming uniformly
    // closes the abuse-budget side channel too.
    await this.inviteRateLimiter.check(orgId, emailCanonical, principal.sub)
    await this.inviteRateLimiter.consume(orgId, emailCanonical, principal.sub)

    const roleId = dto.roleId ?? (await this.getSystemRoleId('MEMBER'))

    const result: CreateInviteResult = await this.prisma.$transaction(async (tx) => {
      await this.acquireXactLock(tx, `org-invite:${orgId}:${emailCanonical}`)

      // OA-05: assignability inside the tx so role.organizationId can't
      // change between check and the membership/invite write.
      await this.roleAssignability.assert(roleId, orgId, tx)

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
      const existing = await tx.orgInvite.findFirst({
        where: {
          organizationId: orgId,
          emailCanonical,
          acceptedAt: null,
          revokedAt: null,
        },
        select: { id: true },
      })

      const rawToken = randomBytes(INVITE_TOKEN_BYTES).toString('base64url')
      const tokenHash = this.hashToken(rawToken)
      const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS)

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

  async revokeInvite(orgId: string, inviteId: string, principal: RequestPrincipal): Promise<void> {
    this.assertOrgContext(principal, orgId)

    const invite = await this.prisma.orgInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        organizationId: true,
        acceptedAt: true,
        revokedAt: true,
      },
    })

    // Missing OR wrong org → 404. Org admins should be able to
    // distinguish "typo / no such invite" from "already revoked"; the
    // route is admin-only and inviteId is server-issued, so this is
    // not an enumeration vector.
    if (!invite || invite.organizationId !== orgId) {
      throw new NotFoundException('Invite not found in this organization')
    }

    // Already accepted: terminal in a different direction. Revoke is
    // meaningless after accept — the resulting member is removed via
    // DELETE /members/:userId. BusinessRuleViolationException surfaces
    // as 400 + errorCode BUSINESS_RULE_VIOLATION so callers can branch
    // on the discriminating wrong-state error code rather than status.
    if (invite.acceptedAt !== null) {
      throw new BusinessRuleViolationException(
        'Cannot revoke an accepted invite — remove the member via DELETE /members/:userId'
      )
    }

    // Already revoked: idempotent no-op. Returning 204 means a retried
    // revoke from a flaky client is safe.
    if (invite.revokedAt !== null) {
      return
    }

    const revokedAt = new Date()
    const result = await this.prisma.orgInvite.updateMany({
      where: {
        id: invite.id,
        organizationId: orgId,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt, revokedById: principal.sub },
    })

    if (result.count !== 1) {
      throw new BusinessRuleViolationException(
        'Cannot revoke an accepted invite — remove the member via DELETE /members/:userId'
      )
    }

    this.logger.info(
      {
        event: 'org.invite.revoked',
        actorUserId: principal.sub,
        actorCredentialType: principal.type,
        orgId,
        inviteId,
      },
      'Org invite revoked'
    )
  }

  async acceptInvite(
    token: string,
    principal: RequestPrincipal,
    ip: string
  ): Promise<AcceptInviteResponse> {
    const fingerprint = InviteAcceptLimiterService.fingerprint(token)

    // Pre-DB limiter check — saturated sources can't hot-miss the DB
    // on tokenHash lookups.
    await this.acceptLimiter.check(ip, fingerprint)

    const tokenHash = this.hashToken(token)

    const invite = await this.prisma.orgInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        organizationId: true,
        emailCanonical: true,
        roleId: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
      },
    })

    // Token not found / accepted / revoked / expired → all consume +
    // uniform 400 INVITE_INVALID_OR_EXPIRED. Distinguishing these
    // states would let an attacker probe a stolen token across
    // identities or learn whether a guessed token is real.
    if (
      !invite ||
      invite.acceptedAt !== null ||
      invite.revokedAt !== null ||
      invite.expiresAt <= new Date()
    ) {
      await this.acceptLimiter.consume(ip, fingerprint)
      throw this.invalidOrExpired()
    }

    // Fresh user lookup — emailVerified gate cannot trust a possibly-
    // stale JWT (the access-token TTL is 15 min). UserCacheService is
    // cache-first with DB fallback; `verifyEmail` properly invalidates
    // so the freshness contract holds.
    const user = await this.userCacheService.getUser(principal.sub)
    if (!user) {
      await this.acceptLimiter.consume(ip, fingerprint)
      throw this.invalidOrExpired()
    }

    // Email canonical match — the invite is bound by canonical email,
    // not by userId, because at create time we may not know the user.
    // The accepting principal must be the canonical-email owner.
    if (this.emailIdentity.canonicalize(user.email) !== invite.emailCanonical) {
      await this.acceptLimiter.consume(ip, fingerprint)
      throw this.invalidOrExpired()
    }

    if (!user.emailVerified) {
      await this.acceptLimiter.consume(ip, fingerprint)
      throw new AppException(
        'Verify your email address before accepting an invite',
        HttpStatus.FORBIDDEN,
        InviteErrorCode.INVITE_EMAIL_NOT_VERIFIED
      )
    }

    // Resolve assigned role with MEMBER fallback. The invite's `roleId`
    // can be null if the named custom role was deleted between create
    // and accept (FK onDelete: SetNull); fall back to the system MEMBER
    // role as a documented lower-privilege default.
    const assignedRoleId = invite.roleId ?? (await this.getSystemRoleId('MEMBER'))
    const orgId = invite.organizationId

    try {
      await this.prisma.$transaction(async (tx) => {
        const acceptedAt = new Date()
        const claimed = await tx.orgInvite.updateMany({
          where: {
            id: invite.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: acceptedAt },
          },
          data: { acceptedAt, acceptedByUserId: user.id },
        })
        if (claimed.count !== 1) {
          throw this.invalidOrExpired()
        }

        // Re-check assignability — a role could have been deleted /
        // moved between create and accept. With `onDelete: SetNull` on
        // OrgInvite.roleId the named role disappears as null; if the
        // fallback (MEMBER) somehow becomes unassignable in some future
        // edge case, we surface the OA-05 uniform 403 here too.
        await this.roleAssignability.assert(assignedRoleId, orgId, tx)

        const member = await this.createMembership(tx, user.id, orgId)
        await tx.memberRole.create({ data: { memberId: member.id, roleId: assignedRoleId } })

        await this.orgsService.bumpAclVersionTx(orgId, tx)
      })
    } catch (e) {
      // Decision-class failures (the invalidOrExpired re-throw, the
      // OA-05 ForbiddenException, the INVITE_ALREADY_MEMBER below):
      // consume the limiter so a leaked token can't be brute-forced
      // across the race window. Infra failures (PrismaPoolTimeout etc)
      // bypass consume per AK-11 decision-vs-infra discriminator —
      // global filters surface them with the correct status.
      if (this.isDecisionFailure(e)) {
        await this.acceptLimiter.consume(ip, fingerprint)
      }
      throw e
    }

    await this.orgsService.invalidateAclVersion(orgId)
    await this.acceptLimiter.reset(fingerprint)

    this.logger.info(
      {
        event: 'org.invite.accepted',
        actorUserId: user.id,
        actorCredentialType: principal.type,
        orgId,
        inviteId: invite.id,
        roleId: assignedRoleId,
      },
      'Org invite accepted'
    )

    return { organizationId: orgId, roleId: assignedRoleId }
  }

  private async createMembership(
    tx: PrismaTx,
    userId: string,
    organizationId: string
  ): Promise<{ id: string }> {
    try {
      return await tx.orgMember.create({
        data: { userId, organizationId },
        select: { id: true },
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' // unique constraint on (userId, organizationId)
      ) {
        throw new AppException(
          'You are already a member of this organization',
          HttpStatus.CONFLICT,
          InviteErrorCode.INVITE_ALREADY_MEMBER
        )
      }
      throw e
    }
  }

  private invalidOrExpired(): AppException {
    return new AppException(
      'This invite link is invalid or has expired',
      HttpStatus.BAD_REQUEST,
      InviteErrorCode.INVITE_INVALID_OR_EXPIRED
    )
  }

  private isDecisionFailure(e: unknown): boolean {
    if (!(e instanceof AppException)) return false
    const status = e.getStatus()
    return (
      status === HttpStatus.BAD_REQUEST ||
      status === HttpStatus.FORBIDDEN ||
      status === HttpStatus.CONFLICT
    )
  }

  private async acquireXactLock(tx: PrismaTx, key: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)::bigint)`
  }

  private assertOrgContext(principal: RequestPrincipal, orgId: string): void {
    if (principal.organizationId !== orgId) {
      throw new ForbiddenException(
        'Organization context mismatch — call POST /organizations/:id/switch first'
      )
    }
  }

  private async getSystemRoleId(name: 'ADMIN' | 'MEMBER'): Promise<string> {
    const role = await this.prisma.role.findFirst({
      where: { name, isSystem: true, organizationId: null },
      select: { id: true },
    })
    if (!role) {
      throw new Error(`System ${name} role not found. Run: pnpm --filter api db:seed`)
    }
    return role.id
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

      const locale: 'ru' | 'en' = args.recipientLocale === 'en' ? 'en' : 'ru'
      const acceptUrl = `${this.env.get('FRONTEND_URL')}/invite/accept?token=${args.rawToken}`

      await this.emailService.sendOrgInviteEmail(args.recipientEmail, {
        orgName: org?.name ?? 'AMCore',
        inviterName: inviter?.name ?? inviter?.email ?? 'AMCore',
        inviterEmail: inviter?.email ?? '',
        roleName: role?.name ?? 'MEMBER',
        hasAccount: args.hasAccount,
        acceptUrl,
        expiresIn: locale === 'en' ? `${INVITE_EXPIRY_DAYS} days` : `${INVITE_EXPIRY_DAYS} дней`,
        locale,
      })
    } catch (err) {
      // Never log the raw token / acceptUrl — only the non-PII email hash.
      this.logger.warn(
        {
          event: 'org.invite.email_dispatch_failed',
          orgId: args.orgId,
          err: err instanceof Error ? err.message : 'unknown',
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
