import { createHash } from 'node:crypto'

import { HttpStatus, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AuthErrorCode } from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../common/exceptions/index.js'
import { AbuseCounterError, AbuseCounterStore } from '../../infrastructure/redis/index.js'

// Defaults match the LoginRateLimiterService style (hardcoded starter
// constants; tune by code change, not env). IP and fingerprint counters
// are sized for plausible legit retry churn (transient errors during
// CI runs, key rotation moments) without leaving brute-force much room.
const IP_MAX = 100
const FINGERPRINT_MAX = 20
const COUNTER_TTL_MS = 60 * 60 * 1000 // 1 hour of inactivity since the last failure

/**
 * Brute-force protection on API-key verification failures (AK-07).
 *
 * Counts failed verifies along two dimensions in Redis: per-IP and
 * per-key-fingerprint. Either counter going over its limit causes the
 * next attempt to return 429 + RATE_LIMIT_EXCEEDED — auth never even
 * touches the DB. Both counters are updated by one atomic script, so
 * concurrent failures are not lost; the limit is still not a reservation:
 * requests that already passed `check` can exceed it by the number in flight.
 *
 * The "fingerprint" is `sha256(shortToken).slice(0, 16)` rather than the
 * raw shortToken. shortToken is technically harmless without longToken
 * (the long secret is what authenticates), but we treat it as credential
 * material anyway — never appears in logs or Redis keys. Fingerprint is
 * deterministic, collision-safe at this width, and reveals nothing.
 *
 * `reset` clears the fingerprint counter on a successful verify but
 * deliberately leaves the IP counter alone — otherwise an attacker with
 * one valid key could wipe their per-IP failure history by interleaving
 * one success between bad attempts.
 *
 * When the counters cannot be read or recorded (Redis down, over its
 * deadline, or an unexpected value) the methods answer 503 instead of
 * treating the state as zero. Whether a timed-out record was applied is
 * unknown; the `abuse_counter.*_failed` warning carries that case.
 */
@Injectable()
export class ApiKeyAbuseLimiterService {
  constructor(
    private readonly counters: AbuseCounterStore,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ApiKeyAbuseLimiterService.name)
  }

  static fingerprint(shortToken: string): string {
    return createHash('sha256').update(shortToken).digest('hex').slice(0, 16)
  }

  /** Throws 429 if either counter is already at or above its limit. */
  async check(ip: string, fingerprint: string): Promise<void> {
    const counts = await this.protect('check', fingerprint, () =>
      this.counters.read(this.ipKey(ip), this.fingerprintKey(fingerprint))
    )

    if (counts.ip >= IP_MAX || counts.subject >= FINGERPRINT_MAX) {
      throw new AppException(
        'Too many failed API key attempts. Please try again later.',
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
      { ip, keyFingerprint: fingerprint, ipCount: counts.ip, fpCount: counts.subject },
      'Failed API key verification'
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
          keyClass: 'api_key',
          case: error.outcome,
          reason: error.kind,
          keyFingerprint: fingerprint,
        },
        'API key abuse counter unavailable'
      )
      throw new ServiceUnavailableException('API key protection temporarily unavailable')
    }
  }

  private ipKey(ip: string): string {
    return `rate:v2:api_key_fail_ip:${ip}`
  }

  private fingerprintKey(fingerprint: string): string {
    return `rate:v2:api_key_fail_token:${fingerprint}`
  }
}
