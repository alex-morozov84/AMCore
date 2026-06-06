import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'
import { PinoLogger } from 'nestjs-pino'
import { from, type Observable, of, switchMap } from 'rxjs'

import { IDEMPOTENCY_METADATA_KEY } from './idempotency.constants'
import {
  idempotencyConflict,
  idempotencyKeyReuse,
  idempotencyUnavailable,
  invalidIdempotencyKey,
} from './idempotency.errors'
import type { IdempotencyOptions } from './idempotency.types'
import { createIdempotencyFingerprint } from './idempotency-fingerprint'
import { parseIdempotencyKey } from './idempotency-header'
import { prepareReplayResponse, responseRecord, wrapSend } from './idempotency-response'
import { IdempotencyStoreService } from './idempotency-store.service'

import { EnvService } from '@/env/env.service'

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private lastDegradeLogAt = 0

  constructor(
    private readonly reflector: Reflector,
    private readonly env: EnvService,
    private readonly store: IdempotencyStoreService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(IdempotencyInterceptor.name)
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<IdempotencyOptions | undefined>(
      IDEMPOTENCY_METADATA_KEY,
      [context.getHandler(), context.getClass()]
    )
    if (!options) return next.handle()

    const http = context.switchToHttp()
    const req = http.getRequest<Request & { rawBody?: Buffer }>()
    const res = http.getResponse<Response>()
    if (req.method !== 'POST') return next.handle()

    const idempotencyKey = parseIdempotencyKey(req)
    if (!idempotencyKey) throw invalidIdempotencyKey()

    const fingerprint = createIdempotencyFingerprint(req)
    return from(this.reserve(options.scope, idempotencyKey, fingerprint)).pipe(
      switchMap((reservation) => {
        if (!reservation) return next.handle()
        if (reservation.kind === 'conflict') throw idempotencyConflict()
        if (reservation.kind === 'mismatch') throw idempotencyKeyReuse()
        if (reservation.kind === 'replay')
          return of(prepareReplayResponse(res, reservation.response))

        wrapSend(res, async (body) =>
          this.complete(reservation.storageKey, reservation.ownerToken, fingerprint, res, body)
        )
        return next.handle()
      })
    )
  }

  private async reserve(
    scope: string,
    key: string,
    fingerprint: string
  ): Promise<Awaited<ReturnType<IdempotencyStoreService['reserve']>> | null> {
    try {
      return await withTimeout(
        this.store.reserve(
          scope,
          key,
          fingerprint,
          this.env.get('IDEMPOTENCY_LOCK_TTL_SECONDS') * 1000
        ),
        this.env.get('IDEMPOTENCY_REDIS_TIMEOUT_MS')
      )
    } catch (err) {
      if (this.env.get('IDEMPOTENCY_FAIL_MODE') === 'closed') throw idempotencyUnavailable()
      this.logDegraded(err)
      return null
    }
  }

  private async complete(
    storageKey: string,
    ownerToken: string,
    fingerprint: string,
    res: Response,
    body: unknown
  ): Promise<void> {
    try {
      await withTimeout(
        this.store.complete(
          storageKey,
          ownerToken,
          fingerprint,
          responseRecord(res, body),
          this.env.get('IDEMPOTENCY_RETENTION_SECONDS')
        ),
        this.env.get('IDEMPOTENCY_REDIS_TIMEOUT_MS')
      )
    } catch (err) {
      this.logDegraded(err)
    }
  }

  private logDegraded(err: unknown): void {
    const now = Date.now()
    if (now - this.lastDegradeLogAt < 60_000) return
    this.lastDegradeLogAt = now
    this.logger.warn({ err }, 'Idempotency Redis unavailable; continuing without response caching')
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('idempotency redis timed out')), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
