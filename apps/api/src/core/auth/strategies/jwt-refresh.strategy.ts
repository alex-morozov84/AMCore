import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';

import { SessionService } from '../session.service';
import { TokenService } from '../token.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService
  ) {
    super({
      jwtFromRequest: () => 'dummy', // We use cookies, not JWT
      ignoreExpiration: true,
      secretOrKey: 'dummy', // Not used
      passReqToCallback: true,
    });
  }

  async validate(req: Request): Promise<{ user: User; refreshTokenHash: string }> {
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token отсутствует');
    }

    const hashedToken = this.tokenService.hashRefreshToken(refreshToken);
    const session = await this.sessionService.findByRefreshToken(hashedToken);

    if (!session) {
      throw new UnauthorizedException('Сессия не найдена или истекла');
    }

    if (session.expiresAt < new Date()) {
      await this.sessionService.deleteByRefreshToken(hashedToken);
      throw new UnauthorizedException('Refresh token истёк');
    }

    return {
      user: session.user,
      refreshTokenHash: hashedToken,
    };
  }
}
