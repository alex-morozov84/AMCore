import { Inject, Injectable } from '@nestjs/common'

import { IntegrationErrorCode } from '@amcore/shared'

import { AppException } from '../../../../common/exceptions/index.js'
import { type AppRedisClient, REDIS_CLIENT } from '../../../../infrastructure/redis/index.js'

import { emailTestKeys } from './email-test.keys.js'
import { EMAIL_TEST_POLICY } from './email-test.policy.js'
import { EMAIL_TEST_SCRIPTS } from './email-test.scripts.js'
import { parseAttempt, parseLast, type StoredAttempt, type StoredLast } from './email-test.view.js'

export function integrationError(
  code: IntegrationErrorCode,
  status: number,
  details?: Record<string, unknown>
): AppException {
  return new AppException(code, status, code, details)
}

export type ReserveResult =
  | { kind: 'reserved'; now: number }
  | { kind: 'replay'; attempt: StoredAttempt }
  | { kind: 'refused'; code: IntegrationErrorCode; retryAfterSeconds?: number }

export interface ReserveInput {
  attemptId: string
  actorId: string
  recipientToken: string
  scopeWitness: string
  leaseToken: string
  provider: 'resend' | 'mock'
}

type Arguments = (string | number)[]

/**
 * Redis access of the operator email test. Every command is bounded (250 ms): a timeout or error
 * refuses the request and never continues into sending. No fallback to process memory.
 */
@Injectable()
export class EmailTestStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: AppRedisClient) {}

  private unavailable(): AppException {
    return integrationError(IntegrationErrorCode.INTEGRATION_PROBE_UNAVAILABLE, 503)
  }

  private async bounded<T>(
    run: (client: ReturnType<AppRedisClient['withCommandOptions']>) => Promise<T>
  ): Promise<T> {
    if (!this.redis.isReady) throw this.unavailable()
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(this.unavailable())
      }, EMAIL_TEST_POLICY.redisCommandMs + 50)
    })
    try {
      return await Promise.race([
        run(
          this.redis.withCommandOptions({
            abortSignal: controller.signal,
            timeout: EMAIL_TEST_POLICY.redisCommandMs,
          })
        ),
        deadline,
      ])
    } catch {
      throw this.unavailable()
    } finally {
      clearTimeout(timer)
    }
  }

  private async script(script: string, keys: string[], args: Arguments): Promise<string[]> {
    const reply = await this.bounded((client) =>
      client.eval(script, { keys, arguments: args.map(String) })
    )
    return Array.isArray(reply) ? reply.map(String) : []
  }

  /** Redis `TIME` in milliseconds: the single time authority for reads. */
  async now(): Promise<number> {
    const reply = await this.bounded((client) => client.sendCommand<string[]>(['TIME']))
    return Number(reply[0]) * 1000 + Math.floor(Number(reply[1]) / 1000)
  }

  async prepare(
    actorId: string,
    attemptId: string,
    recipientToken: string,
    scopeWitness: string
  ): Promise<{ attemptId: string; expiresAt: number }> {
    const [id, expiresAt] = await this.script(
      EMAIL_TEST_SCRIPTS.prepare,
      [emailTestKeys.actor(actorId)],
      [
        attemptId,
        recipientToken,
        scopeWitness,
        EMAIL_TEST_POLICY.issueTtlMs,
        EMAIL_TEST_POLICY.actorTtlMs,
      ]
    )
    if (!id || !expiresAt) throw this.unavailable()
    return { attemptId: id, expiresAt: Number(expiresAt) }
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const reply = await this.script(
      EMAIL_TEST_SCRIPTS.reserve,
      [
        emailTestKeys.attempt(input.attemptId),
        emailTestKeys.actor(input.actorId),
        emailTestKeys.last,
        emailTestKeys.cooldown(input.actorId),
        emailTestKeys.quota,
        emailTestKeys.lease,
      ],
      [
        input.attemptId,
        input.actorId,
        input.recipientToken,
        input.scopeWitness,
        input.leaseToken,
        input.provider,
        EMAIL_TEST_POLICY.operatorCooldownSeconds * 1000,
        EMAIL_TEST_POLICY.platformPerHour,
        EMAIL_TEST_POLICY.leaseSeconds * 1000,
        EMAIL_TEST_POLICY.issueTtlMs,
        EMAIL_TEST_POLICY.deadlineMs,
        EMAIL_TEST_POLICY.attemptTtlMs,
        EMAIL_TEST_POLICY.lastTtlMs,
        EMAIL_TEST_POLICY.actorTtlMs,
      ]
    )
    const [head, second] = reply
    switch (head) {
      case 'RESERVED':
        return { kind: 'reserved', now: Number(second) }
      case 'REPLAY': {
        const raw: Record<string, string> = {}
        for (let index = 1; index + 1 < reply.length; index += 2)
          raw[reply[index]!] = reply[index + 1]!
        const attempt = parseAttempt(raw)
        if (!attempt) throw this.unavailable()
        return { kind: 'replay', attempt }
      }
      case 'MISMATCH':
        return { kind: 'refused', code: IntegrationErrorCode.INTEGRATION_ATTEMPT_MISMATCH }
      case 'EXPIRED':
        return { kind: 'refused', code: IntegrationErrorCode.INTEGRATION_ATTEMPT_EXPIRED }
      case 'RECIPIENT_CHANGED':
        return { kind: 'refused', code: IntegrationErrorCode.INTEGRATION_RECIPIENT_CHANGED }
      case 'CONFIG_CHANGED':
        return { kind: 'refused', code: IntegrationErrorCode.INTEGRATION_CONFIG_CHANGED }
      case 'LIMIT':
        return {
          kind: 'refused',
          code: IntegrationErrorCode.INTEGRATION_PROBE_LIMIT,
          retryAfterSeconds: 600,
        }
      case 'COOLDOWN':
        return {
          kind: 'refused',
          code: IntegrationErrorCode.INTEGRATION_PROBE_COOLDOWN,
          retryAfterSeconds: Math.max(1, Math.ceil(Number(second) / 1000)),
        }
      case 'BUSY':
        return {
          kind: 'refused',
          code: IntegrationErrorCode.INTEGRATION_PROBE_BUSY,
          retryAfterSeconds: 5,
        }
      default:
        throw this.unavailable()
    }
  }

  private keysFor(attemptId: string): string[] {
    return [emailTestKeys.attempt(attemptId), emailTestKeys.last, emailTestKeys.lease]
  }

  async markSending(attemptId: string, leaseToken: string): Promise<boolean> {
    const [head] = await this.script(EMAIL_TEST_SCRIPTS.markSending, this.keysFor(attemptId), [
      attemptId,
      leaseToken,
    ])
    return head === 'OK'
  }

  async failBeforeSend(attemptId: string, leaseToken: string, code: string): Promise<void> {
    await this.script(EMAIL_TEST_SCRIPTS.failBeforeSend, this.keysFor(attemptId), [
      attemptId,
      leaseToken,
      code,
    ])
  }

  async settle(
    attemptId: string,
    leaseToken: string,
    outcome: string,
    probeClass: string
  ): Promise<void> {
    await this.script(EMAIL_TEST_SCRIPTS.settle, this.keysFor(attemptId), [
      attemptId,
      leaseToken,
      outcome,
      probeClass,
    ])
  }

  async readAttempt(attemptId: string): Promise<StoredAttempt | null> {
    const raw = await this.bounded((client) => client.hGetAll(emailTestKeys.attempt(attemptId)))
    return parseAttempt(raw as Record<string, string>)
  }

  async readLast(): Promise<StoredLast | null> {
    const raw = await this.bounded((client) => client.hGetAll(emailTestKeys.last))
    return parseLast(raw as Record<string, string>)
  }

  /** The operator's latest attempt id, as a locator only. */
  async readActorAttempt(actorId: string): Promise<string | null> {
    const id = await this.bounded((client) => client.hGet(emailTestKeys.actor(actorId), 'attempt'))
    return typeof id === 'string' && id.length > 0 ? id : null
  }

  async cooldownRemainingMs(actorId: string): Promise<number> {
    const ttl = await this.bounded((client) => client.pTTL(emailTestKeys.cooldown(actorId)))
    return ttl > 0 ? ttl : 0
  }

  async leaseHeld(): Promise<boolean> {
    return (await this.bounded((client) => client.exists(emailTestKeys.lease))) === 1
  }
}
