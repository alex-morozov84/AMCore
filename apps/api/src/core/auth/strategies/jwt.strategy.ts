import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { type JwtPayload, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions'
import { EnvService } from '../../../env/env.service'
import { PrivilegedRoleService } from '../privileged-role.service'
import { UserCacheService } from '../user-cache.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    env: EnvService,
    private readonly userCache: UserCacheService,
    private readonly privilegedRoles: PrivilegedRoleService
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
   * Signed SUPER_ADMIN claims use primary existence to avoid a Redis-cache prerequisite.
   * Privileged admission still intersects the signed claim with the current primary role.
   */
  async validate(payload: JwtPayload): Promise<RequestPrincipal> {
    const user =
      payload.systemRole === SystemRole.SuperAdmin
        ? await this.privilegedRoles.getCurrentSystemRole(payload.sub)
        : await this.userCache.getUser(payload.sub)

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
      // Bounds derived organization exchange and SSE stream lifetime (ADR-053).
      // Optional legacy claim; missing expiry fails closed on those routes.
      exp: payload.exp,
    }
  }
}
