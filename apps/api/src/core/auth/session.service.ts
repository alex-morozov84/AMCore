import { HttpStatus, Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { PinoLogger } from 'nestjs-pino'

import { AuthErrorCode, type SessionsListResponse, type SupportedLocale } from '@amcore/shared'

import { AppException, NotFoundException } from '../../common/exceptions/index.js'
import type { Prisma, Session, User } from '../../generated/prisma/client.js'
import { GeoIpService } from '../../infrastructure/geoip/geoip.service.js'
import { acquireXactLock, PrismaService } from '../../prisma/index.js'
import {
  type InvitationHandoffProof,
  lockInvitationAuthAttempt,
} from '../invitations/invitation-auth-handoff.js'
import { invitationClock } from '../invitations/invitation-locks.js'

import type { BrowserRequestBinding } from './mfa/browser-binding.js'
import { logoutBrowserSession } from './mfa/browser-session-logout.js'
import { issueFamilyAccessToken } from './mfa/mfa-access-issuance.js'
import { revokeFamilyRows } from './mfa/mfa-family-revocation.js'
import { readRefreshAuthority, refreshSessionChanged } from './mfa/mfa-refresh-authority.js'
import { sessionCoordinationLockKey } from './session-lock-key.js'
import {
  deleteOwnedFamilies,
  deleteOwnedSession,
  deleteRefreshFamily,
} from './session-revocation.js'
import { type AccessTokenPayload, TokenService } from './token.service.js'

export interface CreateSessionParams {
  handoff?: InvitationHandoffProof
  userId: string
  userAgent?: string
  ipAddress?: string
  familyId?: string
}

export interface CreateSessionResult {
  session: Session
  refreshToken: string
}

export interface SessionInfo {
  id: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: Date
  current: boolean
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly geoIp: GeoIpService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(SessionService.name)
  }

  /** Server ticket correlation must refer to its current pending durable handoff. */
  async assertInvitationExchange(
    attemptId: string,
    sessionId: string,
    actorId: string
  ): Promise<void> {
    const handoff = await this.prisma.invitationAuthHandoff.findUnique({ where: { attemptId } })
    const now = await invitationClock(this.prisma)
    if (
      !handoff ||
      handoff.sessionId !== sessionId ||
      handoff.actorId !== actorId ||
      handoff.status !== 'pending' ||
      handoff.deadline <= now
    )
      throw new AppException('Invalid OAuth exchange', 401, AuthErrorCode.OAUTH_TICKET_INVALID)
  }

  /** Create new session, return session row and raw refresh token */
  async createSession(
    params: CreateSessionParams,
    tx?: Prisma.TransactionClient
  ): Promise<CreateSessionResult> {
    if (tx) return this.createSessionTx(params, tx)
    if (params.handoff)
      return this.prisma.$transaction((inner) => this.createSessionTx(params, inner), {
        maxWait: 2000,
        timeout: 4000,
      })
    return this.createSessionTx(params, this.prisma)
  }

  private async createSessionTx(
    params: CreateSessionParams,
    tx: Prisma.TransactionClient
  ): Promise<CreateSessionResult> {
    if (params.handoff) await lockInvitationAuthAttempt(tx, params.handoff)
    const refreshToken = this.tokenService.generateRefreshToken()
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
    const expiresAt = this.tokenService.getRefreshTokenExpiration()

    const session = await tx.session.create({
      data: {
        userId: params.userId,
        familyId: params.familyId ?? this.generateSessionFamilyId(),
        refreshToken: hashedToken,
        userAgent: params.userAgent || null,
        ipAddress: params.ipAddress,
        expiresAt,
        // OB-06b / ADR-037: a freshly created session is freshly authenticated
        // (login / register / OAuth all go through here). Refresh rotation does
        // NOT use createSession — it carries lastAuthAt forward instead.
        lastAuthAt: new Date(),
      },
    })

    if (params.handoff) {
      const now = await invitationClock(tx)
      await tx.invitationAuthHandoff.create({
        data: {
          ...params.handoff,
          sessionId: session.id,
          actorId: params.userId,
          deadline: new Date(now.getTime() + 60_000),
        },
      })
    }
    this.logger.info({ sessionId: session.id, userId: params.userId }, 'Session created')

    return { session, refreshToken }
  }

  /** Find session by refresh token hash */
  async findByRefreshToken(hashedToken: string): Promise<(Session & { user: User }) | null> {
    return this.prisma.session.findUnique({
      where: { refreshToken: hashedToken },
      include: { user: true },
    })
  }

  /** Validate refresh token and detect replay/reuse attempts. */
  async validateRefreshToken(
    hashedToken: string,
    browser: BrowserRequestBinding | null = null
  ): Promise<Session & { user: User }> {
    const session = await this.findByRefreshToken(hashedToken)

    if (!session) {
      throw new AppException(
        'Invalid refresh token',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.TOKEN_INVALID
      )
    }

    if (session.expiresAt < new Date()) {
      // Expiration of an old token row is not a logout of its still-current family.
      await this.prisma.session.deleteMany({ where: { refreshToken: hashedToken } })
      throw new AppException(
        'Refresh token expired',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.TOKEN_INVALID
      )
    }

    if (session.revokedAt) {
      if (session.revocationReason === 'rotated') {
        await this.revokeTokenFamily(session.userId, session.familyId, 'reuse-detected')
      }

      throw new AppException(
        'Refresh token is no longer valid',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.TOKEN_INVALID
      )
    }

    await readRefreshAuthority(this.prisma, session, browser)
    return session
  }

  /**
   * Rotate refresh token (invalidate old, create new).
   *
   * Returns the raw refresh token and the **new** session id so the caller can
   * mint an access token carrying the rotated `sid` (OB-06b). The new row's
   * `lastAuthAt` is carried forward from the rotated session — a silent refresh
   * preserves the step-up freshness window but never renews it (ADR-037).
   */
  async rotateRefreshToken(
    oldHashedToken: string,
    params: CreateSessionParams,
    browser: BrowserRequestBinding | null = null
  ): Promise<{
    refreshToken: string
    sessionId: string
    accessClaims: AccessTokenPayload
    accessToken?: string
  }> {
    const refreshToken = this.tokenService.generateRefreshToken()
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
    const expiresAt = this.tokenService.getRefreshTokenExpiration()

    const outcome = await this.prisma.$transaction(async (tx) => {
      const lookup = await tx.session.findUnique({
        where: { refreshToken: oldHashedToken },
        select: { id: true, userId: true, familyId: true },
      })
      if (!lookup) {
        throw new AppException(
          'Invalid refresh token',
          HttpStatus.UNAUTHORIZED,
          AuthErrorCode.TOKEN_INVALID
        )
      }

      // The attempt coordination lock precedes the account lock, just as publication/confirmation do.
      const handoffHint = await tx.invitationAuthHandoff.findUnique({
        where: { sessionId: lookup.id },
      })
      if (handoffHint) await acquireXactLock(tx, `invitation-auth-attempt:${handoffHint.attemptId}`)

      const familyHint = await tx.authSessionFamily.findUnique({ where: { id: lookup.familyId } })
      if (familyHint?.browserContextId)
        await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${familyHint.browserContextId} FOR UPDATE`

      // Serialize against a concurrent admin revoke-one/all on the
      // SAME owning user before re-reading validity, so a rotation cannot
      // insert a fresh child session after an admin's revoke has already
      // enumerated/acted on the family it belongs to. Re-fetching `existing`
      // below (rather than trusting `lookup`) also re-reads authoritative
      // ownership/state from inside the lock, not from the pre-lock read.
      await acquireXactLock(tx, sessionCoordinationLockKey(lookup.userId))

      const existing = await tx.session.findUnique({
        where: { refreshToken: oldHashedToken },
      })

      if (
        !existing ||
        existing.userId !== lookup.userId ||
        existing.userId !== params.userId ||
        existing.familyId !== lookup.familyId
      ) {
        throw new AppException(
          'Invalid refresh token',
          HttpStatus.UNAUTHORIZED,
          AuthErrorCode.TOKEN_INVALID
        )
      }

      // Lock the tagged handoff before touching the session: pending cannot rotate
      // into an unmarked child session, including during abort/confirmation races.
      const [handoff] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM core.invitation_auth_handoffs WHERE "sessionId" = ${existing.id} FOR UPDATE`
      if (handoff && handoff.status !== 'confirmed')
        throw new AppException(
          'Authentication handoff incomplete',
          401,
          AuthErrorCode.AUTH_HANDOFF_INVALID
        )

      if (existing.expiresAt < new Date()) {
        await tx.session.deleteMany({ where: { refreshToken: oldHashedToken } })
        return {
          error: new AppException(
            'Refresh token expired',
            HttpStatus.UNAUTHORIZED,
            AuthErrorCode.TOKEN_INVALID
          ),
        }
      }

      if (existing.revokedAt) {
        if (existing.revocationReason === 'rotated')
          await revokeFamilyRows(
            tx,
            existing.userId,
            existing.familyId,
            'reuse-detected',
            new Date()
          )
        return {
          error: new AppException(
            'Refresh token is no longer valid',
            HttpStatus.UNAUTHORIZED,
            AuthErrorCode.TOKEN_INVALID
          ),
        }
      }

      const authority = await readRefreshAuthority(tx, existing, browser)
      if ((authority.family?.browserContextId ?? null) !== (familyHint?.browserContextId ?? null))
        throw refreshSessionChanged()

      const revokeResult = await tx.session.updateMany({
        where: {
          refreshToken: oldHashedToken,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revocationReason: 'rotated',
        },
      })

      if (revokeResult.count === 0) {
        await revokeFamilyRows(tx, existing.userId, existing.familyId, 'reuse-detected', new Date())
        return {
          error: new AppException(
            'Refresh token is no longer valid',
            HttpStatus.UNAUTHORIZED,
            AuthErrorCode.TOKEN_INVALID
          ),
        }
      }

      const created = await tx.session.create({
        data: {
          userId: params.userId,
          familyId: existing.familyId,
          refreshToken: hashedToken,
          userAgent: params.userAgent || null,
          ipAddress: params.ipAddress,
          expiresAt,
          // Carry forward, never renew: a silent refresh preserves the step-up
          // freshness window but does not reset it (OB-06b / ADR-037).
          lastAuthAt: existing.lastAuthAt,
        },
      })

      if (authority.family) {
        await tx.authSessionFamily.update({
          where: { id: authority.family.id },
          data: {
            expiresAt: new Date(
              Math.max(authority.family.expiresAt.getTime(), expiresAt.getTime())
            ),
          },
        })
        if (authority.family.browserContextId) {
          const context = await tx.browserAuthContext.findUniqueOrThrow({
            where: { id: authority.family.browserContextId },
          })
          await tx.browserAuthContext.update({
            where: { id: context.id },
            data: {
              expiresAt: new Date(Math.max(context.expiresAt.getTime(), expiresAt.getTime())),
            },
          })
        }
      }
      const accessClaims = { ...authority.claims, sid: created.id }
      const accessToken = authority.family
        ? await issueFamilyAccessToken(tx, this.tokenService, accessClaims)
        : undefined
      return { sessionId: created.id, accessClaims, accessToken }
    })

    if (outcome.error) throw outcome.error
    const sessionId = outcome.sessionId
    this.logger.info({ userId: params.userId }, 'Refresh token rotated')

    return {
      refreshToken,
      sessionId,
      accessClaims: outcome.accessClaims,
      ...(outcome.accessToken !== undefined && { accessToken: outcome.accessToken }),
    }
  }

  /**
   * Is `sessionId` a live session owned by `userId` (not revoked, not expired)?
   * Used by step-up to prove the session is valid BEFORE any password work, so
   * a stolen-but-revoked access token cannot be used as a password oracle
   * (OB-06b). Same predicate as `touchLastAuth`.
   */
  async hasLiveSession(sessionId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.session.count({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    })
    return count > 0
  }

  /**
   * Bump the current session's recent-auth timestamp after a successful
   * step-up (OB-06b / ADR-037). Scoped to the caller's own live session
   * (`id` + `userId`, not revoked, not expired) so it touches exactly one row
   * and never resurrects a revoked/expired session. Returns the affected count
   * so the caller can fail closed when the session is gone (e.g. revoked by a
   * Stage 1 role change). Never creates a session or rotates the refresh token.
   */
  async touchLastAuth(sessionId: string, userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { lastAuthAt: new Date() },
    })
    return result.count
  }

  /** Delete session by refresh token hash */
  async deleteByRefreshToken(hashedToken: string): Promise<void> {
    await deleteRefreshFamily(this.prisma, hashedToken)
  }

  async logoutBrowser(binding: BrowserRequestBinding, refreshHash?: string): Promise<void> {
    await logoutBrowserSession(this.prisma, binding, refreshHash)
  }

  /**
   * Get all active sessions for a user — paginated envelope per
   * ADR-036 / OB-05.
   *
   * ORDER BY createdAt DESC, id ASC for deterministic page boundaries.
   * `current` is computed against `currentTokenHash` for whichever
   * session the caller is currently authenticated as; that session
   * may or may not appear on the requested page.
   */
  async getUserSessions(
    userId: string,
    currentTokenHash: string | undefined,
    page: number,
    limit: number,
    locale: SupportedLocale
  ): Promise<SessionsListResponse> {
    const where = { userId, revokedAt: null, expiresAt: { gt: new Date() } }
    const skip = (page - 1) * limit
    const [sessions, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.session.count({ where }),
    ])

    return {
      data: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        location: this.geoIp.resolve(s.ipAddress, locale),
        createdAt: s.createdAt.toISOString(),
        current: s.refreshToken === currentTokenHash,
      })),
      total,
      page,
      limit,
    }
  }

  /** Delete specific session */
  async deleteSession(sessionId: string, userId: string): Promise<void> {
    if (!(await deleteOwnedSession(this.prisma, userId, sessionId))) {
      throw new NotFoundException('Session', sessionId)
    }

    this.logger.info({ sessionId, userId }, 'Session deleted')
  }

  /** Post-reset cleanup must never delete a new sign-in committed after the reset transaction. */
  async deleteRevokedByUserId(userId: string): Promise<void> {
    const result = await this.prisma.session.deleteMany({
      where: { userId, revokedAt: { not: null } },
    })
    if (result.count > 0)
      this.logger.info({ userId, count: result.count }, 'Revoked sessions deleted')
  }

  /** Delete all sessions for user (e.g. after password reset) */
  async deleteAllByUserId(userId: string): Promise<void> {
    const count = await deleteOwnedFamilies(this.prisma, userId)

    if (count > 0) {
      this.logger.info({ userId, count }, 'All sessions deleted')
    }
  }

  /** Delete all sessions except current */
  async deleteOtherSessions(
    userId: string,
    currentTokenHash: string,
    browser: BrowserRequestBinding | null = null
  ): Promise<void> {
    const count = await deleteOwnedFamilies(this.prisma, userId, currentTokenHash, browser)

    if (count > 0) {
      this.logger.info({ userId, count }, 'Other sessions deleted')
    }
  }

  /** Clean up expired sessions */
  async cleanupExpired(): Promise<void> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })

    if (result.count > 0) {
      this.logger.info({ count: result.count }, 'Expired sessions cleaned up')
    }
  }

  private async revokeTokenFamily(userId: string, familyId: string, reason: string): Promise<void> {
    const count = await this.prisma.$transaction(async (tx) => {
      await acquireXactLock(tx, sessionCoordinationLockKey(userId))
      return revokeFamilyRows(tx, userId, familyId, reason, new Date())
    })
    if (count > 0) this.logger.warn({ familyId, count, reason }, 'Refresh token family revoked')
  }

  private generateSessionFamilyId(): string {
    return randomBytes(16).toString('hex')
  }
}
