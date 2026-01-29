import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';

import type { LoginInput, RegisterInput, UserResponse } from '@amcore/shared';

import type { PrismaService } from '../../prisma';

import type { SessionService } from './session.service';
import type { TokenService } from './token.service';

interface AuthResult {
  user: UserResponse;
  accessToken: string;
  refreshToken: string;
}

interface RequestInfo {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService
  ) {}

  /** Register new user */
  async register(input: RegisterInput, requestInfo: RequestInfo): Promise<AuthResult> {
    // Check if user exists
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existing) {
      throw new ConflictException('Пользователь с таким email уже существует');
    }

    // Hash password
    const passwordHash = await argon2.hash(input.password);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
        lastLoginAt: new Date(),
      },
    });

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
    });

    const refreshToken = await this.sessionService.createSession({
      userId: user.id,
      userAgent: requestInfo.userAgent,
      ipAddress: requestInfo.ipAddress,
    });

    return {
      user: this.mapUserToResponse(user),
      accessToken,
      refreshToken,
    };
  }

  /** Login user */
  async login(input: LoginInput, requestInfo: RequestInfo): Promise<AuthResult> {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    // Verify password
    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
    });

    const refreshToken = await this.sessionService.createSession({
      userId: user.id,
      userAgent: requestInfo.userAgent,
      ipAddress: requestInfo.ipAddress,
    });

    return {
      user: this.mapUserToResponse(user),
      accessToken,
      refreshToken,
    };
  }

  /** Logout (invalidate refresh token) */
  async logout(refreshTokenHash: string): Promise<void> {
    await this.sessionService.deleteByRefreshToken(refreshTokenHash);
  }

  /** Get user by ID */
  async getUserById(id: string): Promise<UserResponse | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    return user ? this.mapUserToResponse(user) : null;
  }

  /** Map Prisma user to API response */
  private mapUserToResponse(user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string | null;
    avatarUrl: string | null;
    locale: string;
    timezone: string;
    createdAt: Date;
    lastLoginAt: Date | null;
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      timezone: user.timezone,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }
}
