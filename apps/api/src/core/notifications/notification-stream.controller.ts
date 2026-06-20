import { Controller, Get, HttpStatus, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { PinoLogger } from 'nestjs-pino'

import { AuthType, type RequestPrincipal } from '@amcore/shared'

import {
  AppException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '../../common/exceptions'
import { Auth } from '../auth/decorators/auth.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'

import { NotificationRealtimeHub } from './realtime/notification-realtime.hub'
import type { NotificationStreamConnection } from './realtime/notification-stream.connection'

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
 * Realtime in-app notification stream (ADR-053, Track B Arc C), web/all role only.
 * A bearer-authenticated SSE endpoint written through a manual bounded writer (not
 * `@Sse`): `@Res()` with no passthrough, so the global Zod serializer never sees the
 * raw stream. Every event is a content-free hint — the durable feed in Postgres is
 * the source of truth, so the client refetches on each event and on reconnect.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Auth(AuthType.Bearer)
@Controller('notifications')
export class NotificationStreamController {
  constructor(
    private readonly hub: NotificationRealtimeHub,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(NotificationStreamController.name)
  }

  @Get('stream')
  @ApiOperation({
    summary: 'Realtime in-app notification stream (SSE)',
    description:
      'Bearer-authenticated Server-Sent Events stream of content-free hints; each ' +
      'event means "refetch the feed/unread". The stream closes at access-token ' +
      'expiry (bounded by a hard server cap); the client refreshes and reconnects.',
  })
  @ApiResponse({
    status: 200,
    description: 'A text/event-stream of disposable notification hints.',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  stream(@CurrentUser() principal: RequestPrincipal, @Res() res: Response): void {
    const lifetimeMs = this.resolveLifetimeMs(principal.exp)

    // A client can drop mid-setup: bind cleanup before admission and aim it at the
    // connection once admitted. The hub's close path is idempotent.
    let connection: NotificationStreamConnection | undefined = undefined
    res.once('close', () => connection?.close('client'))

    const admission = this.hub.register(res, principal.sub, lifetimeMs)
    if (!admission.ok) {
      this.metrics.incNotificationRealtimeEvent(
        admission.reason === 'global' ? 'rejected_global' : 'rejected_user'
      )
      throw admission.reason === 'global'
        ? new ServiceUnavailableException('Realtime stream capacity reached. Retry shortly.')
        : new AppException(
            'Too many concurrent notification streams for this account.',
            HttpStatus.TOO_MANY_REQUESTS,
            'NOTIFICATIONS_REALTIME_MAX_PER_USER'
          )
    }
    connection = admission.connection

    try {
      // Register-in-hub happened above; only now flush headers + the ready frame.
      res.writeHead(HttpStatus.OK, SSE_HEADERS)
      connection.open()
    } catch (err) {
      // The response is now committed to an SSE stream: headers were (or were being)
      // flushed and `close()` ends it. Do NOT rethrow — an exception filter would try
      // to write a JSON error onto a sent/ended response (ERR_HTTP_HEADERS_SENT).
      // Record the failure (bounded metric + structured log, no user id per ADR-053)
      // and tear the registration down quietly; the client reconnects and resyncs.
      this.metrics.incNotificationRealtimeEvent('startup_failure')
      this.logger.warn({ err }, 'Notification SSE stream failed to start after admission')
      connection.close('client')
    }
  }

  /**
   * Stream lifetime = min(token time-to-expiry, configured hard cap). Fail closed: a
   * token without a valid, future integer `exp` may not open a stream (defence in
   * depth beyond the handshake's expiry check).
   */
  private resolveLifetimeMs(exp: number | undefined): number {
    const nowSeconds = Date.now() / 1000
    if (exp === undefined || !Number.isInteger(exp) || exp <= nowSeconds) {
      throw new UnauthorizedException(
        'Access token has no valid expiry; reauthenticate to open a stream.'
      )
    }
    const remainingMs = (exp - nowSeconds) * 1000
    return Math.min(remainingMs, this.env.get('NOTIFICATIONS_REALTIME_MAX_STREAM_LIFETIME_MS'))
  }
}
