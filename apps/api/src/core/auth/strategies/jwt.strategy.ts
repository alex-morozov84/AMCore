import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { type JwtPayload, type RequestPrincipal } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions/index.js'
import { EnvService } from '../../../env/env.service.js'
import {
  hasEnclosingJwtAdmission,
  retainJwtPrimaryProjection,
} from '../mfa/jwt-primary-admission.js'
import { MfaAuthorityReader } from '../mfa/mfa-authority-reader.service.js'
import { PrivilegedRoleService } from '../privileged-role.service.js'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    env: EnvService,
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
   * Existence always comes from the primary database, never from Redis, so a cache outage
   * cannot affect this step. Inside the global guard the one projection read that proves
   * existence is retained and reused by MFA admission (one primary read per request).
   * Privileged admission still intersects the signed claim with the current primary role.
   */
  async validate(
    requestOrPayload: object | JwtPayload,
    signedPayload?: JwtPayload
  ): Promise<RequestPrincipal> {
    const payload = signedPayload ?? (requestOrPayload as JwtPayload)
    const principal = this.principal(payload)
    if (signedPayload && hasEnclosingJwtAdmission(requestOrPayload)) {
      const projection = await this.authority.readPrimaryProjection(payload)
      if (!projection) throw new UnauthorizedException('User not found')
      retainJwtPrimaryProjection(requestOrPayload, principal, projection)
    } else await this.assertExistence(payload)
    return principal
  }

  private async assertExistence(payload: JwtPayload): Promise<void> {
    const role = await this.privilegedRoles.getCurrentSystemRole(payload.sub)
    if (!role) {
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
