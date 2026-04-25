import { CACHE_MANAGER } from '@nestjs/cache-manager'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { Cache } from 'cache-manager'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../common/exceptions'

const IP_MAX = 100
const USER_IP_MAX = 5
const IP_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const USER_IP_TTL_MS = 60 * 60 * 1000 // 1 hour
const BLOCK_TTL_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Login brute-force protection via two Redis counters:
 * - Per-IP: 100 failed attempts / 24h
 * - Per-canonical-email+IP: 5 failed attempts / 1h → 15-min block
 */
@Injectable()
export class LoginRateLimiterService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /** Check limits before attempting login. Throws 429 if exceeded. */
  async check(emailCanonical: string, ip: string): Promise<void> {
    const blocked = await this.cache.get<number>(this.blockedKey(emailCanonical, ip))
    if (blocked) {
      throw new AppException(
        'Too many failed login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
        AuthErrorCode.RATE_LIMIT_EXCEEDED,
        { retryAfterSeconds: 900 }
      )
    }

    const ipCount = (await this.cache.get<number>(this.ipKey(ip))) ?? 0
    if (ipCount >= IP_MAX) {
      throw new AppException(
        'Too many login attempts from this IP. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        AuthErrorCode.RATE_LIMIT_EXCEEDED,
        { retryAfterSeconds: 86400 }
      )
    }
  }

  /** Record a failed login attempt. Sets 15-min block after USER_IP_MAX failures. */
  async consume(emailCanonical: string, ip: string): Promise<void> {
    const ipCount = ((await this.cache.get<number>(this.ipKey(ip))) ?? 0) + 1
    await this.cache.set(this.ipKey(ip), ipCount, IP_TTL_MS)

    const userIpCount =
      ((await this.cache.get<number>(this.userIpKey(emailCanonical, ip))) ?? 0) + 1
    await this.cache.set(this.userIpKey(emailCanonical, ip), userIpCount, USER_IP_TTL_MS)

    if (userIpCount >= USER_IP_MAX) {
      await this.cache.set(this.blockedKey(emailCanonical, ip), 1, BLOCK_TTL_MS)
    }
  }

  /** Reset counters after successful login. */
  async reset(emailCanonical: string, ip: string): Promise<void> {
    await this.cache.del(this.ipKey(ip))
    await this.cache.del(this.userIpKey(emailCanonical, ip))
    await this.cache.del(this.blockedKey(emailCanonical, ip))
  }

  private ipKey(ip: string): string {
    return `rate:login_ip:${ip}`
  }

  private userIpKey(emailCanonical: string, ip: string): string {
    return `rate:login_user_ip:${emailCanonical}:${ip}`
  }

  private blockedKey(emailCanonical: string, ip: string): string {
    return `rate:login_blocked:${emailCanonical}:${ip}`
  }
}
