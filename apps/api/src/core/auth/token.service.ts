import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService
  ) {}

  /** Generate access token (15 min) */
  generateAccessToken(payload: AccessTokenPayload): string {
    return this.jwtService.sign(payload);
  }

  /** Verify access token */
  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwtService.verify<AccessTokenPayload>(token);
  }

  /** Generate random refresh token */
  generateRefreshToken(): string {
    return randomBytes(32).toString('hex');
  }

  /** Hash refresh token for storage */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Get refresh token expiration date */
  getRefreshTokenExpiration(): Date {
    const days = parseInt(this.config.get('JWT_REFRESH_DAYS', '7'), 10);
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + days);
    return expiration;
  }
}
