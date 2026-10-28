import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { type JwtPayload, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions/index.js'
import { EnvService } from '../../../env/env.service.js'
import {
  hasEnclosingJwtAdmission,
  retainJwtPrimaryProjection,
} from '../mfa/jwt-primary-admission.js'
import { MfaAuthorityReader } from '../mfa/mfa-authority-reader.service.js'
import { PrivilegedRoleService } from '../privileged-role.service.js'
import { UserCacheService } from '../user-cache.service.js'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    env: EnvService,
    private readonly userCache: UserCacheService,
    private readonly privilegedRoles: PrivilegedRoleService,
    private readonly authority: MfaAuthorityReader
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: env.get('JWT_SECRET'),
    })
  }

  /**
   * Called after JWT signature is verified.
   * Checks user still exists (security), then returns RequestPrincipal.
   * Signed SUPER_ADMIN claims use primary existence to avoid a Redis-cache prerequisite.
   * Privileged admission still intersects the signed claim with the current primary role.
   */
  async validate(
    requestOrPayload: object | JwtPayload,
    signedPayload?: JwtPayload
  ): Promise<RequestPrincipal> {
    const payload = signedPayload ?? (requestOrPayload as JwtPayload)
    const principal = this.principal(payload)
    const needsPrimary =
      payload.systemRole === SystemRole.SuperAdmin ||
      payload.fid !== undefined ||
      payload.browserBound !== undefined
    if (signedPayload && needsPrimary && hasEnclosingJwtAdmission(requestOrPayload)) {
      const projection = await this.authority.readPrimaryProjection(payload)
      if (!projection) throw new UnauthorizedException('User not found')
      retainJwtPrimaryProjection(requestOrPayload, principal, projection)
    } else await this.assertExistence(payload)
    return principal
  }

  private async assertExistence(payload: JwtPayload): Promise<void> {
    const user =
      payload.systemRole === SystemRole.SuperAdmin ||
      payload.fid !== undefined ||
      payload.browserBound !== undefined
        ? await this.privilegedRoles.getCurrentSystemRole(payload.sub)
        : await this.userCache.getUser(payload.sub)

    if (!user) {
      throw new UnauthorizedException('User not found')
    }
  }

  private principal(payload: JwtPayload): RequestPrincipal {
    return {
      type: 'jwt',
      sub: payload.sub,
      email: payload.email,
      systemRole: payload.systemRole,
      organizationId: payload.organizationId,
      aclVersion: payload.aclVersion,
      ...(payload.fid !== undefined && { fid: payload.fid }),
      ...(payload.securityVersion !== undefined && { securityVersion: payload.securityVersion }),
      ...(payload.browserBound !== undefined && { browserBound: payload.browserBound }),
      // Carried for FreshAuthGuard (OB-06b); inert on all other routes.
      sid: payload.sid,
      // Bounds derived organization exchange and SSE stream lifetime (ADR-053).
      // Optional legacy claim; missing expiry fails closed on those routes.
      exp: payload.exp,
    }
  }
}
