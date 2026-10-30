import { randomUUID } from 'node:crypto'

import { Injectable, type OnModuleDestroy } from '@nestjs/common'

import { AuthErrorCode } from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../../common/exceptions/index.js'
import { EnvService } from '../../../env/env.service.js'
import { LoginLimitConnection } from '../login-limit-connection.js'

import { mfaHash } from './mfa-secrets.js'
import { MFA_SOURCE_LIMIT_SCRIPT } from './mfa-source-limits.lua.js'

/** Source is resolved with the existing trusted visitor/socket policy, never from request body. */
@Injectable()
export class MfaSourceLimiterService implements OnModuleDestroy {
  private stopped = false
  private readonly operations = new Set<LoginLimitConnection>()
  constructor(private readonly env: EnvService) {}

  async consume(kind: 'verify' | 'start', source: string): Promise<void> {
    let operation: LoginLimitConnection | undefined
    let result: unknown
    try {
      if (this.stopped || !source) throw new Error('MFA source unavailable')
      operation = LoginLimitConnection.acquire()
      this.operations.add(operation)
      result = await operation.run(
        () => this.env.get('REDIS_URL'),
        MFA_SOURCE_LIMIT_SCRIPT,
        [`rate:mfa_source:v1:${kind}:${mfaHash(source)}`],
        `${kind}:${randomUUID()}`
      )
      if (
        !Array.isArray(result) ||
        result.length !== 2 ||
        !(
          (result[0] === 1 && result[1] === 0) ||
          (result[0] === 0 && Number.isSafeInteger(result[1]) && result[1] > 0)
        )
      ) {
        throw new Error('Invalid MFA source limiter reply')
      }
    } catch {
      throw new ServiceUnavailableException('MFA protection temporarily unavailable')
    } finally {
      if (operation) this.operations.delete(operation)
    }
    if (Array.isArray(result) && result[0] === 0) {
      throw new AppException('Too many MFA attempts', 429, AuthErrorCode.RATE_LIMIT_EXCEEDED, {
        retryAfterSeconds: result[1],
      })
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true
    await Promise.allSettled([...this.operations].map((operation) => operation.stop()))
  }
}
