import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { type JwtPayload, type RequestPrincipal } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions'
import { EnvService } from '../../../env/env.service'
import { UserCacheService } from '../user-cache.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    env: EnvService,
    private readonly userCache: UserCacheService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.get('JWT_SECRET'),
    })
  }

  /**
   * Called after JWT signature is verified.
   * Checks user still exists (security), then returns RequestPrincipal.
   * Does NOT load full user from DB — only existence check via cache.
   */
  async validate(payload: JwtPayload): Promise<RequestPrincipal> {
    const user = await this.userCache.getUser(payload.sub)

    if (!user) {
      throw new UnauthorizedException('User not found')
    }

    return {
      type: 'jwt',
      sub: payload.sub,
      email: payload.email,
      systemRole: payload.systemRole,
      organizationId: payload.organizationId,
      aclVersion: payload.aclVersion,
      // Carried for FreshAuthGuard (OB-06b); inert on all other routes.
      sid: payload.sid,
      // Carried so the SSE stream can close at token expiry (ADR-053); inert
      // elsewhere. Optional — a token without `exp` fails closed on the stream route.
      exp: payload.exp,
    }
  }
}
