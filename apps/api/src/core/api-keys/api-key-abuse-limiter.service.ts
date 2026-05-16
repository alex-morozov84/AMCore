import { createHash } from 'node:crypto'

import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { Cache } from 'cache-manager'
import { PinoLogger } from 'nestjs-pino'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'

// Defaults match the LoginRateLimiterService style (hardcoded starter
// constants; tune by code change, not env). IP and fingerprint counters
// are sized for plausible legit retry churn (transient errors during
// CI runs, key rotation moments) without leaving brute-force much room.
const IP_MAX = 100
const FINGERPRINT_MAX = 20
const COUNTER_TTL_MS = 60 * 60 * 1000 // 1 hour rolling window

/**
 * Brute-force protection on API-key verification failures (AK-07).
 *
 * Counts failed verifies along two dimensions in Redis: per-IP and
 * per-key-fingerprint. Either counter going over its limit causes the
 * next attempt to return 429 + RATE_LIMIT_EXCEEDED — auth never even
 * touches the DB.
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
 */
@Injectable()
export class ApiKeyAbuseLimiterService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ApiKeyAbuseLimiterService.name)
  }

  static fingerprint(shortToken: string): string {
    return createHash('sha256').update(shortToken).digest('hex').slice(0, 16)
  }

  /** Throws 429 if either counter is already at or above its limit. */
  async check(ip: string, fingerprint: string): Promise<void> {
    const ipCount = (await this.cache.get<number>(this.ipKey(ip))) ?? 0
    const fpCount = (await this.cache.get<number>(this.fingerprintKey(fingerprint))) ?? 0

    if (ipCount >= IP_MAX || fpCount >= FINGERPRINT_MAX) {
      throw new AppException(
        'Too many failed API key attempts. Please try again later.',
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
      { ip, keyFingerprint: fingerprint, ipCount, fpCount },
      'Failed API key verification'
    )
  }

  /** Clears the fingerprint counter only — IP counter must not be reset. */
  async reset(fingerprint: string): Promise<void> {
    await this.cache.del(this.fingerprintKey(fingerprint))
  }

  private ipKey(ip: string): string {
    return `rate:api_key_fail_ip:${ip}`
  }

  private fingerprintKey(fingerprint: string): string {
    return `rate:api_key_fail_token:${fingerprint}`
  }
}
