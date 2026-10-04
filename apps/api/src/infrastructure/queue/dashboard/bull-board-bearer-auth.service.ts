import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

import { type JwtPayload, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { UnauthorizedException } from '../../../common/exceptions'
import { PrivilegedAdmissionService } from '../../../core/auth/privileged-admission.service'

export type BullBoardBearerAccess =
  | { readonly kind: 'authorized'; readonly userId: string }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unavailable' }

/**
 * Admission of the Console BFF's request to the board: a live SUPER_ADMIN access token.
 *
 * It applies the same invariant as every privileged route (ADR-037) — the role in the ORIGINAL signed
 * claim intersected with the CURRENT role in the primary database — by reusing
 * `PrivilegedAdmissionService`, not by a second verifier. So a USER claim never becomes SUPER_ADMIN
 * because the database now says so, and a demoted admin is refused on the next request. It runs on
 * every request (page, asset, data), without a cache. Like the cookie path it must not import
 * `AuthModule` (`QueueModule → AuthModule → EmailModule → QueueModule` would close a cycle); it needs
 * only the JWT verifier and the two privileged-role providers, which depend on Prisma alone.
 *
 * Outcomes are four on purpose: an infrastructure failure is `unavailable` (503), never a 401/403,
 * so the Console can tell "could not verify" from "not allowed".
 */
@Injectable()
export class BullBoardBearerAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly admission: PrivilegedAdmissionService
  ) {}

  async verify(accessToken: string): Promise<BullBoardBearerAccess> {
    let payload: JwtPayload
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(accessToken, { algorithms: ['HS256'] })
    } catch {
      return { kind: 'unauthenticated' }
    }
    if (typeof payload?.sub !== 'string' || payload.sub.length === 0) {
      return { kind: 'unauthenticated' }
    }
    // The signed claim must itself say SUPER_ADMIN: the database alone can never grant it.
    if (payload.systemRole !== SystemRole.SuperAdmin) return { kind: 'forbidden' }

    const principal: RequestPrincipal = {
      type: 'jwt',
      sub: payload.sub,
      email: payload.email,
      systemRole: payload.systemRole,
      organizationId: payload.organizationId,
      aclVersion: payload.aclVersion,
      sid: payload.sid,
      exp: payload.exp,
    }
    try {
      const { principal: effective } = await this.admission.resolve(principal, [
        SystemRole.SuperAdmin,
      ])
      // `resolve` demotes a stale claim to USER instead of throwing: the result must be checked.
      return effective.systemRole === SystemRole.SuperAdmin
        ? { kind: 'authorized', userId: payload.sub }
        : { kind: 'forbidden' }
    } catch (error) {
      return error instanceof UnauthorizedException
        ? { kind: 'unauthenticated' }
        : { kind: 'unavailable' }
    }
  }
}
