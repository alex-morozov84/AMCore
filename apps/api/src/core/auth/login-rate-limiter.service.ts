import { HttpStatus, Injectable, type OnModuleDestroy } from '@nestjs/common'

import { AuthErrorCode } from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../common/exceptions/index.js'
import { EnvService } from '../../env/env.service.js'

import { LoginLimitConnection } from './login-limit-connection.js'
import { LOGIN_LIMIT_SCRIPT } from './login-rate-limits.lua.js'

/** Atomic recorded-failure accounting; admission does not reserve a password check. */
@Injectable()
export class LoginRateLimiterService implements OnModuleDestroy {
  private stopped = false
  private readonly operations = new Set<LoginLimitConnection>()
  constructor(private readonly env: EnvService) {}

  async check(emailCanonical: string, ip: string): Promise<void> {
    const [allowed, retryAfterSeconds] = await this.command('check', emailCanonical, ip)
    if (allowed === 0)
      throw new AppException(
        retryAfterSeconds === 900
          ? 'Too many failed login attempts. Please try again in 15 minutes.'
          : 'Too many login attempts from this IP. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        AuthErrorCode.RATE_LIMIT_EXCEEDED,
        { retryAfterSeconds }
      )
  }

  async consume(emailCanonical: string, ip: string): Promise<void> {
    await this.command('consume', emailCanonical, ip)
  }

  /** Clear only the successful pair/block; preserve aggregate IP debt and TTL. */
  async reset(emailCanonical: string, ip: string): Promise<void> {
    await this.command('reset', emailCanonical, ip)
  }

  private async command(
    mode: 'check' | 'consume' | 'reset',
    email: string,
    ip: string
  ): Promise<[number, number]> {
    let operation: LoginLimitConnection | undefined
    try {
      if (this.stopped) throw new Error('Login limiter stopped')
      operation = LoginLimitConnection.acquire()
      this.operations.add(operation)
      const result = await operation.run(
        () => this.env.get('REDIS_URL'),
        LOGIN_LIMIT_SCRIPT,
        [
          `rate:login_ip:${ip}`,
          `rate:login_user_ip:${email}:${ip}`,
          `rate:login_blocked:${email}:${ip}`,
        ],
        mode
      )
      if (
        !Array.isArray(result) ||
        result.length !== 2 ||
        !(
          (result[0] === 1 && result[1] === 0) ||
          (mode === 'check' && result[0] === 0 && [900, 86400].includes(result[1]))
        )
      )
        throw new Error('Invalid login limiter reply')
      return result as [number, number]
    } catch {
      throw new ServiceUnavailableException('Login protection temporarily unavailable')
    } finally {
      if (operation) this.operations.delete(operation)
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true
    await Promise.allSettled([...this.operations].map((operation) => operation.stop()))
  }
}
