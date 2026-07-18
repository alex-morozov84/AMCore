import { HttpStatus, Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { PinoLogger } from 'nestjs-pino'

import { AuthErrorCode, type SessionsListResponse } from '@amcore/shared'

import { AppException, NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import { TokenService } from './token.service'

import type { Session, User } from '@/generated/prisma/client'

interface CreateSessionParams {
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
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(SessionService.name)
  }

  /** Create new session, return session row and raw refresh token */
  async createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    const refreshToken = this.tokenService.generateRefreshToken()
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
    const expiresAt = this.tokenService.getRefreshTokenExpiration()

    const session = await this.prisma.session.create({
      data: {
        userId: params.userId,
        familyId: params.familyId ?? this.generateSessionFamilyId(),
        refreshToken: hashedToken,
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
        expiresAt,
        // OB-06b / ADR-037: a freshly created session is freshly authenticated
        // (login / register / OAuth all go through here). Refresh rotation does
        // NOT use createSession — it carries lastAuthAt forward instead.
        lastAuthAt: new Date(),
      },
    })

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
  async validateRefreshToken(hashedToken: string): Promise<Session & { user: User }> {
    const session = await this.findByRefreshToken(hashedToken)

    if (!session) {
      throw new AppException(
        'Invalid refresh token',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.TOKEN_INVALID
      )
    }

    if (session.expiresAt < new Date()) {
      await this.deleteByRefreshToken(hashedToken)
      throw new AppException(
        'Refresh token expired',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.TOKEN_INVALID
      )
    }

    if (session.revokedAt) {
      if (session.revocationReason === 'rotated') {
        await this.revokeTokenFamily(session.familyId, 'reuse-detected')
      }

      throw new AppException(
        'Refresh token is no longer valid',
        HttpStatus.UNAUTHORIZED,
        AuthErrorCode.TOKEN_INVALID
      )
    }

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
    params: CreateSessionParams
  ): Promise<{ refreshToken: string; sessionId: string }> {
    const refreshToken = this.tokenService.generateRefreshToken()
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
    const expiresAt = this.tokenService.getRefreshTokenExpiration()

    const sessionId = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.session.findUnique({
        where: { refreshToken: oldHashedToken },
      })

      if (!existing) {
        throw new AppException(
          'Invalid refresh token',
          HttpStatus.UNAUTHORIZED,
          AuthErrorCode.TOKEN_INVALID
        )
      }

      if (existing.expiresAt < new Date()) {
        await tx.session.deleteMany({
          where: { refreshToken: oldHashedToken },
        })
        throw new AppException(
          'Refresh token expired',
          HttpStatus.UNAUTHORIZED,
          AuthErrorCode.TOKEN_INVALID
        )
      }

      if (existing.revokedAt) {
        if (existing.revocationReason === 'rotated') {
          await tx.session.updateMany({
            where: {
              familyId: existing.familyId,
              revokedAt: null,
            },
            data: {
              revokedAt: new Date(),
              revocationReason: 'reuse-detected',
            },
          })
        }

        throw new AppException(
          'Refresh token is no longer valid',
          HttpStatus.UNAUTHORIZED,
          AuthErrorCode.TOKEN_INVALID
        )
      }

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
        await tx.session.updateMany({
          where: {
            familyId: existing.familyId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
            revocationReason: 'reuse-detected',
          },
        })

        throw new AppException(
          'Refresh token is no longer valid',
          HttpStatus.UNAUTHORIZED,
          AuthErrorCode.TOKEN_INVALID
        )
      }

      const created = await tx.session.create({
        data: {
          userId: params.userId,
          familyId: existing.familyId,
          refreshToken: hashedToken,
          userAgent: params.userAgent,
          ipAddress: params.ipAddress,
          expiresAt,
          // Carry forward, never renew: a silent refresh preserves the step-up
          // freshness window but does not reset it (OB-06b / ADR-037).
          lastAuthAt: existing.lastAuthAt,
        },
      })

      return created.id
    })

    this.logger.info({ userId: params.userId }, 'Refresh token rotated')

    return { refreshToken, sessionId }
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
    await this.prisma.session.deleteMany({
      where: { refreshToken: hashedToken },
    })
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
    limit: number
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
    const result = await this.prisma.session.deleteMany({
      where: { id: sessionId, userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Session', sessionId)
    }

    this.logger.info({ sessionId, userId }, 'Session deleted')
  }

  /** Delete all sessions for user (e.g. after password reset) */
  async deleteAllByUserId(userId: string): Promise<void> {
    const result = await this.prisma.session.deleteMany({ where: { userId } })

    if (result.count > 0) {
      this.logger.info({ userId, count: result.count }, 'All sessions deleted')
    }
  }

  /** Delete all sessions except current */
  async deleteOtherSessions(userId: string, currentTokenHash: string): Promise<void> {
    const result = await this.prisma.session.deleteMany({
      where: {
        userId,
        NOT: { refreshToken: currentTokenHash },
      },
    })

    if (result.count > 0) {
      this.logger.info({ userId, count: result.count }, 'Other sessions deleted')
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

  private async revokeTokenFamily(familyId: string, reason: string): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: {
        familyId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revocationReason: reason,
      },
    })

    if (result.count > 0) {
      this.logger.warn({ familyId, count: result.count, reason }, 'Refresh token family revoked')
    }
  }

  private generateSessionFamilyId(): string {
    return randomBytes(16).toString('hex')
  }
}
