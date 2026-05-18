import { createHash } from 'node:crypto'

import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { Cache } from 'cache-manager'
import { PinoLogger } from 'nestjs-pino'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'

// Mirror ApiKeyAbuseLimiterService constants (AK-07): per-IP cap for
// any source, per-token-fingerprint cap so a single leaked token can't
// be brute-forced against many unverified accounts in succession.
const IP_MAX = 100
const FINGERPRINT_MAX = 20
const COUNTER_TTL_MS = 60 * 60 * 1000 // 1 hour rolling window

/**
 * Brute-force protection on invite-accept failures (OB-02).
 *
 * Mirrors `ApiKeyAbuseLimiterService` (AK-07) exactly — same dual-axis
 * counters in Redis (per-IP and per-token-fingerprint), same rolling
 * 1h TTL, same `reset(fingerprint)` semantics that intentionally leave
 * the IP counter alone so a successful accept doesn't whitewash unrelated
 * abuse from the same source.
 *
 * The fingerprint is `sha256(token).slice(0, 16)` — the raw token is
 * treated as credential material (an attacker holding only the token
 * can complete an accept against the matching identity), so it never
 * appears in Redis keys or logs.
 *
 * `check` runs before any DB work in `InviteService.acceptInvite` so a
 * saturated source can't hot-miss the DB on tokenHash lookups.
 * `consume` is called on every failed accept decision — token not found,
 * expired, revoked, already accepted, email mismatch, emailVerified=false —
 * so a leaked token can't be brute-forced across multiple identities or
 * unverified accounts. Infra errors deliberately do not consume (per
 * AK-11 decision-vs-infra discriminator); the caller decides which class
 * the failure belongs to. `reset` is called only after successful accept.
 */
@Injectable()
export class InviteAcceptLimiterService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(InviteAcceptLimiterService.name)
  }

  static fingerprint(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 16)
  }

  /** Throws 429 if either counter is already at or above its limit. */
  async check(ip: string, fingerprint: string): Promise<void> {
    const ipCount = (await this.cache.get<number>(this.ipKey(ip))) ?? 0
    const fpCount = (await this.cache.get<number>(this.fingerprintKey(fingerprint))) ?? 0

    if (ipCount >= IP_MAX || fpCount >= FINGERPRINT_MAX) {
      throw new AppException(
        'Too many failed invite accept attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        AuthErrorCode.RATE_LIMIT_EXCEEDED,
        { retryAfterSeconds: 3600 }
      )
    }
  }

  /** Increments both counters; logs WARN with the fingerprint, not the token. */
  async consume(ip: string, fingerprint: string): Promise<void> {
    const ipCount = ((await this.cache.get<number>(this.ipKey(ip))) ?? 0) + 1
    await this.cache.set(this.ipKey(ip), ipCount, COUNTER_TTL_MS)

    const fpCount = ((await this.cache.get<number>(this.fingerprintKey(fingerprint))) ?? 0) + 1
    await this.cache.set(this.fingerprintKey(fingerprint), fpCount, COUNTER_TTL_MS)

    this.logger.warn(
      { ip, inviteFingerprint: fingerprint, ipCount, fpCount },
      'Failed invite accept attempt'
    )
  }

  /** Clears the fingerprint counter only — IP counter must not be reset. */
  async reset(fingerprint: string): Promise<void> {
    await this.cache.del(this.fingerprintKey(fingerprint))
  }

  private ipKey(ip: string): string {
    return `rate:invite_accept_fail_ip:${ip}`
  }

  private fingerprintKey(fingerprint: string): string {
    return `rate:invite_accept_fail_token:${fingerprint}`
  }
}
