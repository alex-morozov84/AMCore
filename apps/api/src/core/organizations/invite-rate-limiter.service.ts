import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { Cache } from 'cache-manager'
import { PinoLogger } from 'nestjs-pino'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'

// Hardcoded starter constants (mirror LoginRateLimiterService /
// ApiKeyAbuseLimiterService style; tune by code change, not env).
//
// PAIR limit bounds email-bomb on a single victim: re-inviting the
// same address inside an org is rare in legitimate operations; an
// admin probing for "did the previous invite go through?" stays well
// under three. Counted per (orgId, emailCanonical) so an attacker
// cannot whitewash by switching the inviter identity.
//
// INVITER limit bounds actor-scale abuse inside one org: a legitimate
// onboarding batch is rarely more than 30 invites per inviter per hour.
// Counted per (inviterId, orgId) — a SUPER_ADMIN orchestrating across
// many orgs is allowed their per-org budget in each.
const PAIR_MAX = 3
const INVITER_MAX = 30
const COUNTER_TTL_MS = 60 * 60 * 1000 // 1 hour rolling window

/**
 * Invite-creation rate limiter (OB-02).
 *
 * Bounds two independent abuse vectors on `POST .../members/invite`:
 *
 *   - Per-(orgId, emailCanonical): prevents email-bomb on a single
 *     address by repeated invitation from inside one org.
 *   - Per-(inviterId, orgId): prevents an admin-identity-scoped
 *     enumeration burst across many target emails.
 *
 * Both counters are consumed atomically on every `createInvite` entry
 * regardless of which branch the request takes
 * (already-member / known-user / unknown-email / rotation), so the
 * limiter state can't be probed to leak email-existence — a successful
 * 202 and a failed 429 are the only observable outcomes, both invariant
 * to whether the email is registered.
 *
 * The limiter has no `reset` operation. Both counters age out via TTL.
 * Stage B's `InviteService.createInvite` calls `check` first (throws
 * 429 on overflow) then `consume` on the path through.
 */
@Injectable()
export class InviteRateLimiterService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(InviteRateLimiterService.name)
  }

  /** Throws 429 if either counter is already at or above its limit. */
  async check(orgId: string, emailCanonical: string, inviterId: string): Promise<void> {
    const pairCount = (await this.cache.get<number>(this.pairKey(orgId, emailCanonical))) ?? 0
    const inviterCount = (await this.cache.get<number>(this.inviterKey(inviterId, orgId))) ?? 0

    if (pairCount >= PAIR_MAX || inviterCount >= INVITER_MAX) {
      throw new AppException(
        'Too many invite attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        AuthErrorCode.RATE_LIMIT_EXCEEDED,
        { retryAfterSeconds: 3600 }
      )
    }
  }

  /** Increments both counters; logs at debug — invite rate-limits are not abuse signals on their own. */
  async consume(orgId: string, emailCanonical: string, inviterId: string): Promise<void> {
    const pairCount = ((await this.cache.get<number>(this.pairKey(orgId, emailCanonical))) ?? 0) + 1
    await this.cache.set(this.pairKey(orgId, emailCanonical), pairCount, COUNTER_TTL_MS)

    const inviterCount =
      ((await this.cache.get<number>(this.inviterKey(inviterId, orgId))) ?? 0) + 1
    await this.cache.set(this.inviterKey(inviterId, orgId), inviterCount, COUNTER_TTL_MS)

    this.logger.debug({ orgId, inviterId, pairCount, inviterCount }, 'Invite rate limiter consumed')
  }

  private pairKey(orgId: string, emailCanonical: string): string {
    return `rate:org_invite_pair:${orgId}:${emailCanonical}`
  }

  private inviterKey(inviterId: string, orgId: string): string {
    return `rate:org_invite_actor:${inviterId}:${orgId}`
  }
}
