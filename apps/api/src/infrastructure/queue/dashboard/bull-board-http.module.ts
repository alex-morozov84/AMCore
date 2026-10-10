import type { createBullBoard } from '@bull-board/api'
import { BULL_BOARD_INSTANCE, BullBoardModule } from '@bull-board/nestjs'
import { Inject, Module, type OnModuleInit, Optional } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { ControlConnection } from '../../background-work/control-connection'
import { QUEUE_REGISTRY } from '../constants/queue-inventory.constant'
import { QueueModule } from '../queue.module'

import { BoundedBullMQAdapter } from './bounded-bullmq-adapter'
import { createBullBoardAuthMiddleware } from './bull-board-auth.middleware'
import { BullBoardAuthModule } from './bull-board-auth.module'
import { BullBoardAuthService } from './bull-board-auth.service'
import { BullBoardBearerAuthService } from './bull-board-bearer-auth.service'
import { chainBoardMiddleware, createBullBoardBoundary } from './bull-board-boundary.middleware'
import type { BoardEvent } from './bull-board-events'
import { BOARD_HOOKS, BOARD_UI_CONFIG } from './bull-board-hooks'
import { BullBoardLegacyFlagWarning } from './bull-board-legacy-flag'
import { BULL_BOARD_MOUNT } from './bull-board-mount-state'
import { QueueBoardAdapter } from './bull-board-ui-adapter'

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
    ]
  : []

/** HTTP-only integration: producer infrastructure has no authentication dependency. */
@Module({
  imports: [QueueModule, ...bullBoardImports],
  providers: [BullBoardLegacyFlagWarning],
})
export class BullBoardHttpModule implements OnModuleInit {
  constructor(
    @Inject(QUEUE_REGISTRY) private readonly queues: ReadonlyMap<string, Queue>,
    private readonly control: ControlConnection,
    @Optional()
    @Inject(BULL_BOARD_INSTANCE)
    private readonly board?: ReturnType<typeof createBullBoard>
  ) {}

  onModuleInit(): void {
    if (!this.board) return
    for (const queue of this.queues.values()) {
      this.board.addQueue(new BoundedBullMQAdapter(queue, this.control))
    }
  }
}
