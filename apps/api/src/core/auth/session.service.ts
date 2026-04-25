import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import type { Session, User } from '@prisma/client'
import { randomBytes } from 'crypto'

import { NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import { TokenService } from './token.service'

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
  private readonly logger = new Logger(SessionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService
  ) {}

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
      },
    })

    this.logger.log('Session created', {
      sessionId: session.id,
      userId: params.userId,
    })

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
      throw new UnauthorizedException('Invalid refresh token')
    }

    if (session.expiresAt < new Date()) {
      await this.deleteByRefreshToken(hashedToken)
      throw new UnauthorizedException('Refresh token expired')
    }

    if (session.revokedAt) {
      if (session.revocationReason === 'rotated') {
        await this.revokeTokenFamily(session.familyId, 'reuse-detected')
      }

      throw new UnauthorizedException('Refresh token is no longer valid')
    }

    return session
  }

  /** Rotate refresh token (invalidate old, create new) */
  async rotateRefreshToken(oldHashedToken: string, params: CreateSessionParams): Promise<string> {
    const refreshToken = this.tokenService.generateRefreshToken()
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
    const expiresAt = this.tokenService.getRefreshTokenExpiration()

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.session.findUnique({
        where: { refreshToken: oldHashedToken },
      })

      if (!existing) {
        throw new UnauthorizedException('Invalid refresh token')
      }

      if (existing.expiresAt < new Date()) {
        await tx.session.deleteMany({
          where: { refreshToken: oldHashedToken },
        })
        throw new UnauthorizedException('Refresh token expired')
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

        throw new UnauthorizedException('Refresh token is no longer valid')
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

        throw new UnauthorizedException('Refresh token is no longer valid')
      }

      await tx.session.create({
        data: {
          userId: params.userId,
          familyId: existing.familyId,
          refreshToken: hashedToken,
          userAgent: params.userAgent,
          ipAddress: params.ipAddress,
          expiresAt,
        },
      })
    })

    this.logger.log('Refresh token rotated', { userId: params.userId })

    return refreshToken
  }

  /** Delete session by refresh token hash */
  async deleteByRefreshToken(hashedToken: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { refreshToken: hashedToken },
    })
  }

  /** Get all sessions for user */
  async getUserSessions(userId: string, currentTokenHash?: string): Promise<SessionInfo[]> {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      current: s.refreshToken === currentTokenHash,
    }))
  }

  /** Delete specific session */
  async deleteSession(sessionId: string, userId: string): Promise<void> {
    const result = await this.prisma.session.deleteMany({
      where: { id: sessionId, userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Session', sessionId)
    }

    this.logger.log('Session deleted', { sessionId, userId })
  }

  /** Delete all sessions for user (e.g. after password reset) */
  async deleteAllByUserId(userId: string): Promise<void> {
    const result = await this.prisma.session.deleteMany({ where: { userId } })

    if (result.count > 0) {
      this.logger.log('All sessions deleted', { userId, count: result.count })
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
      this.logger.log('Other sessions deleted', {
        userId,
        count: result.count,
      })
    }
  }

  /** Clean up expired sessions */
  async cleanupExpired(): Promise<void> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })

    if (result.count > 0) {
      this.logger.log('Expired sessions cleaned up', { count: result.count })
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
      this.logger.warn('Refresh token family revoked', {
        familyId,
        count: result.count,
        reason,
      })
    }
  }

  private generateSessionFamilyId(): string {
    return randomBytes(16).toString('hex')
  }
}
