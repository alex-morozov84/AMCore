import { createHash } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AuthErrorCode } from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../common/exceptions/index.js'
import { AbuseCounterError, AbuseCounterStore } from '../../infrastructure/redis/index.js'

// Mirror ApiKeyAbuseLimiterService constants (AK-07): per-IP cap for
// any source, per-token-fingerprint cap so a single leaked token can't
// be brute-forced against many unverified accounts in succession.
const IP_MAX = 100
const FINGERPRINT_MAX = 20
const COUNTER_TTL_MS = 60 * 60 * 1000 // 1 hour of inactivity since the last failure

/**
 * Brute-force protection on invite-accept failures (OB-02).
 *
 * Mirrors `ApiKeyAbuseLimiterService` (AK-07) exactly — same dual-axis
 * counters in Redis (per-IP and per-token-fingerprint), same one-hour
 * inactivity expiry, same `reset(fingerprint)` semantics that intentionally leave
 * the IP counter alone so a successful accept doesn't whitewash unrelated
 * abuse from the same source. Both counters share one atomic script and one
 * shared store.
 *
 * The fingerprint is `sha256(token).slice(0, 16)` — the raw token is
 * treated as credential material (an attacker holding only the token
 * can complete an accept against the matching identity), so it never
 * appears in Redis keys or logs.
 *
 * `check` runs before any DB work in `InviteService.acceptInvite` so a
 * saturated source can't hot-miss the DB on tokenHash lookups.
 * `consume` records a failed attempt on every failed accept decision — token not found,
 * expired, revoked, already accepted, email mismatch, emailVerified=false —
 * so a leaked token can't be brute-forced across multiple identities or
 * unverified accounts. Infra errors deliberately do not consume (per
 * AK-11 decision-vs-infra discriminator); the caller decides which class
 * the failure belongs to. `reset` is called only after successful accept.
 *
 * When the counters cannot be read or recorded the methods answer 503 instead
 * of treating the state as zero. The caller decides what that means for its
 * outcome: `InviteAcceptService` keeps the original invitation error when only
 * the record fails, and the `abuse_counter.*_failed` warning carries whether
 * the record was never sent or has an unknown outcome.
 */
@Injectable()
export class InviteAcceptLimiterService {
  constructor(
    private readonly counters: AbuseCounterStore,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(InviteAcceptLimiterService.name)
  }

  static fingerprint(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 16)
  }

  /** Throws 429 if either counter is already at or above its limit. */
  async check(ip: string, fingerprint: string): Promise<void> {
    const counts = await this.protect('check', fingerprint, () =>
      this.counters.read(this.ipKey(ip), this.fingerprintKey(fingerprint))
    )

    if (counts.ip >= IP_MAX || counts.subject >= FINGERPRINT_MAX) {
      throw new AppException(
        'Too many failed invite accept attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        AuthErrorCode.RATE_LIMIT_EXCEEDED,
        { retryAfterSeconds: 3600 }
      )
    }
  }

  /** Records one failed attempt on both counters; logs WARN with the fingerprint, not the token. */
  async consume(ip: string, fingerprint: string): Promise<void> {
    const counts = await this.protect('record', fingerprint, () =>
      this.counters.increment(this.ipKey(ip), this.fingerprintKey(fingerprint), COUNTER_TTL_MS)
    )

    this.logger.warn(
      { ip, inviteFingerprint: fingerprint, ipCount: counts.ip, fpCount: counts.subject },
      'Failed invite accept attempt'
    )
  }

  /** Clears the fingerprint counter only — IP counter must not be reset. */
  async reset(fingerprint: string): Promise<void> {
    await this.protect('reset', fingerprint, () =>
      this.counters.clear(this.fingerprintKey(fingerprint))
    )
  }

  private async protect<T>(
    step: 'check' | 'record' | 'reset',
    fingerprint: string,
    call: () => Promise<T>
  ): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (!(error instanceof AbuseCounterError)) throw error
      this.logger.warn(
        {
          event: `abuse_counter.${step}_failed`,
          keyClass: 'invite_accept',
          case: error.outcome,
          reason: error.kind,
          inviteFingerprint: fingerprint,
        },
        'Invite accept abuse counter unavailable'
      )
      throw new ServiceUnavailableException('Invitation protection temporarily unavailable')
    }
  }

  private ipKey(ip: string): string {
    return `rate:v2:invite_accept_fail_ip:${ip}`
  }

  private fingerprintKey(fingerprint: string): string {
    return `rate:v2:invite_accept_fail_token:${fingerprint}`
  }
}
