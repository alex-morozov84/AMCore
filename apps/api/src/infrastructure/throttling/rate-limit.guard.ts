import { createHash } from 'node:crypto'

import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'

import { AppException } from '../../common/exceptions'
import { EnvService } from '../../env/env.service'
import { MetricsService } from '../observability'

import { resolveTracker } from './client-tracker'
import { GcraRedisLimiter } from './gcra-redis-limiter.service'
import { RATE_LIMIT_POLICY_KEY, RATE_LIMIT_SKIP_KEY } from './rate-limit.decorator'
import {
  classifyPolicy,
  RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
  resolveBurst,
} from './rate-limit-policies'

/**
 * The only global rate-limit guard (Option O, ADR-073 — replaces
 * `@nestjs/throttler` entirely). Registered before `AuthenticationGuard`
 * (`ThrottlingModule` is imported ahead of `AuthModule` in `app-imports.ts`),
 * preserving today's ordering.
 *
 * `@SkipRateLimit()` -> pass. Otherwise resolves the handler's `@RateLimit(...)`
 * policy, falling back to `RATE_LIMIT_POLICIES.DEFAULT`, and performs exactly
 * one `consume()` call — one Redis round trip, not the two sequential calls
 * `@nestjs/throttler`'s named-throttler model required (ADR-039's own
 * accepted "Consequences" limitation, closed here).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: GcraRedisLimiter,
    private readonly env: EnvService,
    private readonly metrics: MetricsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler()
    const cls = context.getClass()

    const skip = this.reflector.getAllAndOverride<boolean>(RATE_LIMIT_SKIP_KEY, [handler, cls])
    if (skip) return true

    const policy =
      this.reflector.getAllAndOverride<RateLimitPolicy>(RATE_LIMIT_POLICY_KEY, [handler, cls]) ??
      RATE_LIMIT_POLICIES.DEFAULT

    const http = context.switchToHttp()
    const req = http.getRequest<Request>()
    const res = http.getResponse<Response>()

    const tracker = resolveTracker(req, this.env)
    const key = createHash('sha256').update(`${cls.name}-${handler.name}-${tracker}`).digest('hex')

    const decision = await this.limiter.consume(key, policy)
    const burst = resolveBurst(policy)

    // Standard, unsuffixed headers (RFC 9110) — a real change from
    // @nestjs/throttler's named-throttler-suffixed `-short`/`-long` forms.
    // X-RateLimit-Limit = burst, never `rate`: `remaining` counts down from
    // `burst - 1` on the very first request from idle, so pairing it with
    // `Limit = rate` would be self-contradictory.
    res.setHeader('X-RateLimit-Limit', String(burst))
    res.setHeader('X-RateLimit-Remaining', String(decision.allowed ? decision.remaining : 0))
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(decision.resetAfterMs / 1000)))

    this.metrics.incRateLimitDecision(
      classifyPolicy(policy),
      decision.allowed ? 'allowed' : 'refused'
    )

    if (!decision.allowed) {
      // retryAfterMs is normally positive; -1 is the Lua script's sentinel
      // for "this cost can never fit inside burst" (a policy misconfiguration
      // unreachable with today's fixed cost=1 and every policy's burst >= 1).
      // Math.max(1, ...) keeps Retry-After a sane, spec-valid value even then.
      const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
      res.setHeader('Retry-After', String(retryAfterSeconds))
      throw new AppException(
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMIT_EXCEEDED',
        { retryAfterSeconds }
      )
    }

    return true
  }
}
