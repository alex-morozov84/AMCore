import { Injectable, Logger } from '@nestjs/common'
import type { Session, User } from '@prisma/client'

import { NotFoundException } from '../../common/exceptions'
import { PrismaService } from '../../prisma'

import { TokenService } from './token.service'

interface CreateSessionParams {
  userId: string
  userAgent?: string
  ipAddress?: string
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

  /** Create new session, return raw refresh token */
  async createSession(params: CreateSessionParams): Promise<string> {
    const refreshToken = this.tokenService.generateRefreshToken()
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
    const expiresAt = this.tokenService.getRefreshTokenExpiration()

    const session = await this.prisma.session.create({
      data: {
        userId: params.userId,
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

    return refreshToken
  }

  /** Find session by refresh token hash */
  async findByRefreshToken(hashedToken: string): Promise<(Session & { user: User }) | null> {
    return this.prisma.session.findUnique({
      where: { refreshToken: hashedToken },
      include: { user: true },
    })
  }

  /** Rotate refresh token (invalidate old, create new) */
  async rotateRefreshToken(oldHashedToken: string, params: CreateSessionParams): Promise<string> {
    // Delete old session
    await this.prisma.session.delete({
      where: { refreshToken: oldHashedToken },
    })

    this.logger.log('Refresh token rotated', { userId: params.userId })

    // Create new session
    return this.createSession(params)
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
      where: { userId },
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
}
