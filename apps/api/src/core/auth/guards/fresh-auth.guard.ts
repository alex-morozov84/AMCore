import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { type RequestPrincipal } from '@amcore/shared'

import { EnvService } from '../../../env/env.service.js'
import { PrismaService } from '../../../prisma/index.js'
import { assertSessionFresh } from '../session-freshness.js'

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
 * `request.user` (with `sid`) is already populated. Protected accounts require
 * their current family's independently fresh password and second-factor proofs.
 *
 * Fail-closed everywhere with `403 STEP_UP_REQUIRED` — missing `sid` (legacy
 * token), missing/revoked/expired session or stale proofs. Changed family/browser
 * authority returns terminal409. Ordinary accounts retain password lastAuthAt;
 * protected step-up returns the missing proof types and never becomes complete
 * from a password-only timestamp update. Unannotated routes do not read freshness.
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
    const windowSec = maxAge ?? this.env.get('STEP_UP_MAX_AGE_SECONDS')
    await assertSessionFresh(this.prisma, windowSec, request.user)
    return true
  }
}
