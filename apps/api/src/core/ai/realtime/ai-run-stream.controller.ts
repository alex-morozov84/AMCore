import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { PinoLogger } from 'nestjs-pino'

import { AuthType, type RequestPrincipal } from '@amcore/shared'

import {
  AppException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '../../../common/exceptions'
import { Auth } from '../../auth/decorators/auth.decorator'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import { AiRunService } from '../runs/ai-run.service'

import { AiRunRealtimeHub } from './ai-run-realtime.hub'
import type { AiRunStreamConnection } from './ai-run-stream.connection'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'

/** SSE response headers (ADR-053): no caching/buffering, keep-alive event stream. */
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

/**
 * Status-only realtime AI run stream (Track C — ADR-054, Arc C.5; ADR-053 pattern), web/all role
 * only. A bearer-authenticated, owner-scoped SSE endpoint written through a manual bounded writer
 * (not `@Sse`): `@Res()` with no passthrough, so the global Zod serializer never sees the raw
 * stream. Every event is a **content-free** run-status hint — the durable run in Postgres is the
 * source of truth, so the client refetches `GET /ai/runs/:id` on each event and on reconnect. No
 * token streaming: the event carries status metadata only, never generated content.
 *
 * Ownership is verified (via the run's conversation) BEFORE any header is flushed; a missing or
 * not-owned run is a 404 so existence never leaks — the same rule the read/cancel surface uses.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('ai/runs')
export class AiRunStreamController {
  constructor(
    private readonly runs: AiRunService,
    private readonly hub: AiRunRealtimeHub,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunStreamController.name)
  }

  @Get(':id/stream')
  @ApiOperation({
    summary: 'Status-only realtime AI run stream (SSE)',
    description:
      'Bearer-authenticated Server-Sent Events stream of content-free run-status hints; each ' +
      'event means "refetch this run" (GET /ai/runs/:id). Not token streaming — no generated ' +
      'content crosses this stream. Closes at access-token expiry (bounded by a hard server cap); ' +
      'the client refreshes and reconnects.',
  })
  @ApiResponse({
    status: 200,
    description: 'A text/event-stream of disposable run-status hints.',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  async stream(
    @CurrentUser() principal: RequestPrincipal,
    @Param('id') runId: string,
    @Res() res: Response
  ): Promise<void> {
    // Owner check first (404 if missing/not-owned) — throws before any SSE header is flushed.
    await this.runs.getOwned(principal.sub, runId)

    const lifetimeMs = this.resolveLifetimeMs(principal.exp)

    // A client can drop mid-setup: bind cleanup before admission and aim it at the connection once
    // admitted. The hub's close path is idempotent.
    let connection: AiRunStreamConnection | undefined = undefined
    res.once('close', () => connection?.close('client'))

    const admission = this.hub.register(res, principal.sub, runId, lifetimeMs)
    if (!admission.ok) {
      this.metrics.incAiRunRealtimeEvent(
        admission.reason === 'global' ? 'rejected_global' : 'rejected_user'
      )
      throw admission.reason === 'global'
        ? new ServiceUnavailableException('Realtime stream capacity reached. Retry shortly.')
        : new AppException(
            'Too many concurrent AI run streams for this account.',
            HttpStatus.TOO_MANY_REQUESTS,
            'AI_REALTIME_MAX_PER_USER'
          )
    }
    connection = admission.connection

    try {
      // Register-in-hub happened above; only now flush headers + the ready frame.
      res.writeHead(HttpStatus.OK, SSE_HEADERS)
      connection.open()
    } catch (err) {
      // The response is now committed to an SSE stream: headers were (or were being) flushed and
      // `close()` ends it. Do NOT rethrow — an exception filter would try to write a JSON error onto
      // a sent/ended response (ERR_HTTP_HEADERS_SENT). Record the failure (bounded metric +
      // structured log, no user id) and tear the registration down quietly; the client reconnects.
      this.metrics.incAiRunRealtimeEvent('startup_failure')
      this.logger.warn({ err }, 'AI run SSE stream failed to start after admission')
      connection.close('client')
    }
  }

  /**
   * Stream lifetime = min(token time-to-expiry, configured hard cap). Fail closed: a token without a
   * valid, future integer `exp` may not open a stream (defence in depth beyond the handshake's
   * expiry check).
   */
  private resolveLifetimeMs(exp: number | undefined): number {
    const nowSeconds = Date.now() / 1000
    if (exp === undefined || !Number.isInteger(exp) || exp <= nowSeconds) {
      throw new UnauthorizedException(
        'Access token has no valid expiry; reauthenticate to open a stream.'
      )
    }
    const remainingMs = (exp - nowSeconds) * 1000
    return Math.min(remainingMs, this.env.get('AI_REALTIME_MAX_STREAM_LIFETIME_MS'))
  }
}
