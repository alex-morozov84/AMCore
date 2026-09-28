import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { randomBytes } from 'crypto'

import { type SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../common/exceptions'
import { EnvService } from '../../env/env.service'

import { hashRefreshToken } from './utils/refresh-token-hash'

export interface AccessTokenPayload {
  sub: string
  email: string
  systemRole: SystemRole
  organizationId?: string
  aclVersion?: number
  // OB-06b / ADR-037: session id, read only by FreshAuthGuard on
  // @RequireFreshAuth routes. Passed straight through sign/verify.
  sid?: string
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly env: EnvService
  ) {}

  /** Generate access token (15 min) */
  generateAccessToken(payload: AccessTokenPayload): string {
    return this.jwtService.sign(payload)
  }

  /** Exchange cannot extend the authenticated parent's residual access window. */
  generateDerivedAccessToken(payload: AccessTokenPayload, parentExpiry?: number): string {
    const iat = Math.floor(Date.now() / 1000)
    if (!Number.isSafeInteger(parentExpiry) || parentExpiry! <= iat) {
      throw new UnauthorizedException('Parent access token must have a future expiry')
    }
    return this.jwtService.sign({ ...payload, iat }, { expiresIn: parentExpiry! - iat })
  }

  /** Verify access token */
  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwtService.verify<AccessTokenPayload>(token)
  }

  /** Generate random refresh token */
  generateRefreshToken(): string {
    return randomBytes(32).toString('hex')
  }

  /** Hash refresh token for storage (delegates to the shared pure helper) */
  hashRefreshToken(token: string): string {
    return hashRefreshToken(token)
  }

  /** Get refresh token expiration date */
  getRefreshTokenExpiration(): Date {
    const days = this.env.get('JWT_REFRESH_DAYS')
    const expiration = new Date()
    expiration.setDate(expiration.getDate() + days)
    return expiration
  }
}
