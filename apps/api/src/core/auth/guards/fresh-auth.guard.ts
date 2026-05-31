import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthErrorCode, type RequestPrincipal } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { EnvService } from '../../../env/env.service'
import { PrismaService } from '../../../prisma'

/**
 * Metadata key set by `@RequireFreshAuth`. Value semantics:
 * - `undefined` → route not annotated (guard returns true, no DB read).
 * - `null`      → annotated with no override → use `STEP_UP_MAX_AGE_SECONDS`.
 * - `number`    → annotated with an explicit per-route window (seconds).
 *
 * Lives here (not in the decorator) so the decorator can import the guard
 * without a circular dependency.
 */
export const REQUIRE_FRESH_AUTH_KEY = 'requireFreshAuth'

/**
 * FreshAuthGuard (OB-06b / ADR-037 — step-up).
 *
 * Method-level guard attached only via `@RequireFreshAuth`. It runs AFTER the
 * global `AuthenticationGuard` (Nest order: global → controller → method), so
 * `request.user` (with `sid`) is already populated. It loads the session by
 * `sid` and requires it to have been (re)authenticated within the window.
 *
 * Fail-closed everywhere with `403 STEP_UP_REQUIRED` — missing `sid` (legacy
 * token), missing/revoked/expired session, owner mismatch, NULL `lastAuthAt`
 * (pre-migration row), or stale `lastAuthAt`. 403 (not 401) so a generic client
 * 401→refresh handler can't loop; the client branches on the errorCode to call
 * `POST /auth/step-up`. The session read happens ONLY on annotated routes, so
 * the `sid` claim adds no cost to ordinary authenticated traffic.
 */
@Injectable()
export class FreshAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly env: EnvService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const maxAge = this.reflector.getAllAndOverride<number | null | undefined>(
      REQUIRE_FRESH_AUTH_KEY,
      [context.getHandler(), context.getClass()]
    )

    // Not annotated → nothing to enforce, no DB read.
    if (maxAge === undefined) return true

    const request = context.switchToHttp().getRequest<{ user?: RequestPrincipal }>()
    const principal = request.user
    const sid = principal?.sid
    if (!sid || !principal) {
      throw this.stepUpRequired()
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sid },
      select: { lastAuthAt: true, revokedAt: true, expiresAt: true, userId: true },
    })

    const now = Date.now()
    const windowSec = maxAge ?? this.env.get('STEP_UP_MAX_AGE_SECONDS')

    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now ||
      session.userId !== principal.sub ||
      session.lastAuthAt === null ||
      now - session.lastAuthAt.getTime() > windowSec * 1000
    ) {
      throw this.stepUpRequired()
    }

    return true
  }

  private stepUpRequired(): AppException {
    return new AppException(
      'Step-up authentication required',
      HttpStatus.FORBIDDEN,
      AuthErrorCode.STEP_UP_REQUIRED
    )
  }
}
