import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma';
import { TokenService } from './token.service';

interface CreateSessionParams {
  userId: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  current: boolean;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService
  ) {}

  /** Create new session, return raw refresh token */
  async createSession(params: CreateSessionParams): Promise<string> {
    const refreshToken = this.tokenService.generateRefreshToken();
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken);
    const expiresAt = this.tokenService.getRefreshTokenExpiration();

    await this.prisma.session.create({
      data: {
        userId: params.userId,
        refreshToken: hashedToken,
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
        expiresAt,
      },
    });

    return refreshToken;
  }

  /** Find session by refresh token hash */
  async findByRefreshToken(hashedToken: string) {
    return this.prisma.session.findUnique({
      where: { refreshToken: hashedToken },
      include: { user: true },
    });
  }

  /** Rotate refresh token (invalidate old, create new) */
  async rotateRefreshToken(oldHashedToken: string, params: CreateSessionParams): Promise<string> {
    // Delete old session
    await this.prisma.session.delete({
      where: { refreshToken: oldHashedToken },
    });

    // Create new session
    return this.createSession(params);
  }

  /** Delete session by refresh token hash */
  async deleteByRefreshToken(hashedToken: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { refreshToken: hashedToken },
    });
  }

  /** Get all sessions for user */
  async getUserSessions(userId: string, currentTokenHash?: string): Promise<SessionInfo[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      current: s.refreshToken === currentTokenHash,
    }));
  }

  /** Delete specific session */
  async deleteSession(sessionId: string, userId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { id: sessionId, userId },
    });
  }

  /** Delete all sessions except current */
  async deleteOtherSessions(userId: string, currentTokenHash: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: {
        userId,
        NOT: { refreshToken: currentTokenHash },
      },
    });
  }

  /** Clean up expired sessions */
  async cleanupExpired(): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
