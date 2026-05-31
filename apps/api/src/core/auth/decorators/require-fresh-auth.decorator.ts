import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'

import { FreshAuthGuard, REQUIRE_FRESH_AUTH_KEY } from '../guards/fresh-auth.guard'

/**
 * @RequireFreshAuth() — require a recently re-authenticated session (OB-06b /
 * ADR-037 step-up).
 *
 * Attaches the method-level `FreshAuthGuard` (runs after the global
 * `AuthenticationGuard` populates `request.user`) and records the freshness
 * window. With no argument the guard uses `STEP_UP_MAX_AGE_SECONDS` (env
 * default 600s); pass `maxAgeSec` to override per route.
 *
 * Apply only to destructive privileged operations — the guard does a session
 * read per request, so annotate sparingly.
 *
 * ```typescript
 * @RequireFreshAuth()
 * @Patch('users/:id')
 * updateUserSystemRole() {}
 * ```
 */
export function RequireFreshAuth(maxAgeSec?: number): ReturnType<typeof applyDecorators> {
  return applyDecorators(
    SetMetadata(REQUIRE_FRESH_AUTH_KEY, maxAgeSec ?? null),
    UseGuards(FreshAuthGuard)
  )
}
