import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

import { type JwtPayload, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { AppException, UnauthorizedException } from '../../../common/exceptions/index.js'
import { MfaAuthorityReader } from '../../../core/auth/mfa/mfa-authority-reader.service.js'
import { PrivilegedAdmissionService } from '../../../core/auth/privileged-admission.service.js'
import { BrowserSessionContextService } from '../../../core/frontend-context/browser-session-context.service.js'

import { type BoardAuthRequest, boardBrowserBinding } from './bull-board-auth-context.js'

export type BullBoardBearerAccess =
  | { readonly kind: 'authorized'; readonly userId: string }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'session_changed' }

/**
 * Admission of the Console BFF's request to the board: a live SUPER_ADMIN access token.
 *
 * It applies the same invariant as every privileged route (ADR-037) — the role in the ORIGINAL signed
 * claim intersected with the CURRENT role in the primary database — by reusing
 * `PrivilegedAdmissionService`, not by a second verifier. So a USER claim never becomes SUPER_ADMIN
 * because the database now says so, and a demoted admin is refused on the next request. It runs on
 * every request (page, asset, data), without a cache. Like the cookie path it must not import
 * `AuthModule` (`QueueModule → AuthModule → EmailModule → QueueModule` would close a cycle); it needs
 * the JWT verifier, primary family/role readers and private browser normalization.
 *
 * Changed family/browser authority is terminal409. An infrastructure failure is503, never401/403,
 * so the Console can tell "could not verify" from "not allowed".
 */
@Injectable()
export class BullBoardBearerAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly admission: PrivilegedAdmissionService,
    private readonly authority: MfaAuthorityReader,
    private readonly contexts: BrowserSessionContextService
  ) {}

  async verify(accessToken: string, request?: BoardAuthRequest): Promise<BullBoardBearerAccess> {
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
      ...(payload.fid !== undefined && { fid: payload.fid }),
      ...(payload.securityVersion !== undefined && { securityVersion: payload.securityVersion }),
      ...(payload.browserBound !== undefined && { browserBound: payload.browserBound }),
    }
    try {
      const binding = boardBrowserBinding(this.contexts, request)
      const { principal: effective } = await this.admission.resolve(principal, [
        SystemRole.SuperAdmin,
      ])
      // `resolve` demotes a stale claim to USER instead of throwing: the result must be checked.
      if (effective.systemRole !== SystemRole.SuperAdmin) return { kind: 'forbidden' }
      const result = await this.authority.readForRuntime(payload, binding)
      if (result.kind === 'denied')
        return {
          kind: result.reason === 'enforcement_unavailable' ? 'unavailable' : 'session_changed',
        }
      return result.operator ? { kind: 'authorized', userId: payload.sub } : { kind: 'forbidden' }
    } catch (error) {
      if (error instanceof AppException && error.errorCode === 'SESSION_CHANGED')
        return { kind: 'session_changed' }
      if (error instanceof AppException && error.getStatus() === 403) return { kind: 'forbidden' }
      return error instanceof UnauthorizedException
        ? { kind: 'unauthenticated' }
        : { kind: 'unavailable' }
    }
  }
}
