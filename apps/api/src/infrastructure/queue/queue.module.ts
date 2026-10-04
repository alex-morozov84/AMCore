import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { BullBoardModule } from '@bull-board/nestjs'
import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { QUEUE_REGISTRY } from './constants/queue-inventory.constant'
import { createBullBoardAuthMiddleware } from './dashboard/bull-board-auth.middleware'
import { BullBoardAuthModule } from './dashboard/bull-board-auth.module'
import { BullBoardAuthService } from './dashboard/bull-board-auth.service'
import { BullBoardBearerAuthService } from './dashboard/bull-board-bearer-auth.service'
import {
  chainBoardMiddleware,
  createBullBoardBoundary,
} from './dashboard/bull-board-boundary.middleware'
import type { BoardEvent } from './dashboard/bull-board-events'
import { BOARD_HOOKS, BOARD_UI_CONFIG } from './dashboard/bull-board-hooks'
import { BullBoardLegacyFlagWarning } from './dashboard/bull-board-legacy-flag'
import { BULL_BOARD_MOUNT } from './dashboard/bull-board-mount-state'
import { QueueBoardAdapter } from './dashboard/bull-board-ui-adapter'
import { DEFAULT_JOB_OPTIONS } from './interfaces/job-options.interface'
import { QueueService } from './queue.service'
import { boardQueueNames, enabledQueueNames } from './queue-inventory'
import { QueueObservationService } from './queue-observation.service'
import { buildBullConnection } from './redis-connection.config'

import { EnvModule } from '@/env/env.module'
import { EnvService } from '@/env/env.service'

/** Content-free board events go to the structured log; never a payload, token or job id. */
function boardEventSink(logger: PinoLogger): (event: BoardEvent) => void {
  logger.setContext('BullBoard')
  return (event) => {
    if (event.event === 'bull_board.access_denied') logger.warn(event, event.event)
    else logger.info(event, event.event)
  }
}

/**
 * The queue board (Bull Board) is read-only by construction: every adapter is built read-only, the
 * HTTP boundary lets through only GET/HEAD on a short list of paths, and every response is rebuilt
 * by a closed projection (see `dashboard/`). Nothing configurable changes that.
 *
 * Whether it is mounted is the ONE startup decision in `BULL_BOARD_MOUNT`: absent from the module
 * graph entirely in production unless `ENABLE_BULL_BOARD=true` is a real process environment
 * variable (the decision is taken before `ConfigModule` loads `.env`), never on the worker role.
 */
const bullBoardImports = BULL_BOARD_MOUNT.mounted
  ? [
      // Authentication and the read-only boundary run before the mounted Bull Board router.
      BullBoardModule.forRootAsync({
        imports: [BullBoardAuthModule],
        inject: [BullBoardAuthService, BullBoardBearerAuthService, PinoLogger],
        useFactory: (
          cookieAuth: BullBoardAuthService,
          bearerAuth: BullBoardBearerAuthService,
          logger: PinoLogger
        ) => {
          const events = boardEventSink(logger)
          return {
            route: '/admin/queues',
            adapter: QueueBoardAdapter,
            middleware: chainBoardMiddleware(
              createBullBoardAuthMiddleware(cookieAuth, bearerAuth, events),
              createBullBoardBoundary(events)
            ),
            boardOptions: {
              // Checks the projected response against the Board's schema; a mismatch fails closed.
              validateResponses: true,
              handlerHooks: BOARD_HOOKS,
              uiConfig: BOARD_UI_CONFIG,
            },
          }
        },
      }),
      ...boardQueueNames().map((name) =>
        BullBoardModule.forFeature({
          name,
          adapter: BullMQAdapter,
          options: { readOnlyMode: true, allowRetries: false },
        })
      ),
    ]
  : []

@Module({
  imports: [
    // Global BullMQ setup
    BullModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => {
        return {
          // EQS-06: TLS (rediss://), ACL username, and a reconnect retryStrategy
          // — built from the validated REDIS_URL by a single tested helper.
          connection: buildBullConnection(env.get('REDIS_URL')),
          prefix: 'amcore',
          // EQS-11: single source of truth for default job options.
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        }
      },
    }),

    // Register every enabled queue of the single inventory (constants/queue-inventory.constant.ts).
    BullModule.registerQueue(...enabledQueueNames().map((name) => ({ name }))),

    // Bull Board dashboard — mounted + auth-protected only when enabled.
    ...bullBoardImports,
  ],
  providers: [
    {
      provide: QUEUE_REGISTRY,
      inject: enabledQueueNames().map((name) => getQueueToken(name)),
      useFactory: (...queues: Queue[]) =>
        new Map(enabledQueueNames().map((name, index) => [name, queues[index]] as const)),
    },
    QueueService,
    QueueObservationService,
    BullBoardLegacyFlagWarning,
  ],
  exports: [QueueService, QueueObservationService],
})
export class QueueModule {}
