import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { Redis } from 'ioredis'

import { AuthErrorCode, SupportMailErrorCode, type SupportMailKind } from '@amcore/shared'

import { AppException } from '../../common/exceptions/index.js'
import { EnvService } from '../../env/env.service.js'
import { buildBullConnection } from '../../infrastructure/queue/redis-connection.config.js'

import { AUTH_MAIL_PREPARE, AUTH_MAIL_RESERVE } from './auth-mail-limits.lua.js'

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const prefix = 'amcore:auth-mail:v1:'

@Injectable()
export class AuthMailLimiter {
  private static active = 0
  constructor(private readonly env: EnvService) {}

  private async command(script: string, keys: string[], args: string[]): Promise<[number, number]> {
    if (AuthMailLimiter.active >= 32) throw this.unavailable()
    AuthMailLimiter.active += 1
    const client = new Redis({
      ...buildBullConnection(this.env.get('REDIS_URL')),
      lazyConnect: true,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      autoResubscribe: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      reconnectOnError: () => false,
      connectTimeout: 250,
      commandTimeout: 250,
    })
    client.on('error', () => undefined)
    try {
      await client.connect()
      const value: unknown = await client.eval(script, keys.length, ...keys, ...args)
      if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isSafeInteger))
        throw this.unavailable()
      return value as [number, number]
    } catch {
      throw this.unavailable()
    } finally {
      client.disconnect(false)
      AuthMailLimiter.active -= 1
    }
  }

  async reserve(emailCanonical: string, kind: SupportMailKind, actorId?: string): Promise<void> {
    const [allowed, retryAfterSeconds] = await this.command(
      AUTH_MAIL_RESERVE,
      this.keys(emailCanonical, kind, actorId),
      [actorId ? 'admin' : 'public']
    )
    if (allowed === -1) throw this.unavailable()
    if (allowed !== 1)
      throw new AppException(
        'Mail request limit reached',
        429,
        actorId ? SupportMailErrorCode.SUPPORT_MAIL_LIMIT : AuthErrorCode.RATE_LIMIT_EXCEEDED,
        { retryAfterSeconds, effect: 'none', tokenIssued: false }
      )
  }

  async status(
    emailCanonical: string,
    kind: SupportMailKind,
    actorId: string
  ): Promise<{ reason: 'limit' | 'cooldown' | null; retryAfterSeconds: number }> {
    const [allowed, retryAfterSeconds] = await this.command(
      AUTH_MAIL_RESERVE,
      this.keys(emailCanonical, kind, actorId),
      ['status']
    )
    if (allowed === -1) throw this.unavailable()
    return {
      reason: allowed === 0 ? 'limit' : allowed === 2 ? 'cooldown' : null,
      retryAfterSeconds,
    }
  }

  private keys(emailCanonical: string, kind: SupportMailKind, actorId?: string): string[] {
    return [
      `${prefix}recipient:${kind}:${hash(emailCanonical)}`,
      `${prefix}actor:${hash(actorId ?? '')}`,
      `${prefix}cooldown:${kind}:${hash(emailCanonical)}`,
      `rate:${kind === 'password_recovery' ? 'forgot' : 'resend-verification'}:${emailCanonical}`,
    ]
  }

  async prepare(actorId: string): Promise<void> {
    const [allowed, retryAfterSeconds] = await this.command(
      AUTH_MAIL_PREPARE,
      [`${prefix}prepare:${hash(actorId)}`],
      []
    )
    if (allowed === -1) throw this.unavailable()
    if (allowed !== 1)
      throw new AppException(
        'Preparation limit reached',
        429,
        SupportMailErrorCode.SUPPORT_MAIL_LIMIT,
        { retryAfterSeconds, effect: 'none', tokenIssued: false }
      )
  }

  private unavailable(): AppException {
    return new AppException(
      'Mail budget unavailable',
      503,
      SupportMailErrorCode.SUPPORT_MAIL_UNAVAILABLE,
      { effect: 'none', tokenIssued: false }
    )
  }
}
