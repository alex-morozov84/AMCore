import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { BullBoardModule } from '@bull-board/nestjs'
import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { QueueName } from './constants/queues.constant'
import { createBullBoardAuthMiddleware } from './dashboard/bull-board-auth.middleware'
import { BullBoardAuthModule } from './dashboard/bull-board-auth.module'
import { BullBoardAuthService } from './dashboard/bull-board-auth.service'
import { isBullBoardEnabled, isBullBoardReadOnly } from './dashboard/bull-board-mount-gate'
import { DashboardController } from './dashboard/dashboard.controller'
import { DEFAULT_JOB_OPTIONS } from './interfaces/job-options.interface'
import { QueueService } from './queue.service'
import { buildBullConnection } from './redis-connection.config'

import { EnvModule } from '@/env/env.module'
import { EnvService } from '@/env/env.service'

/**
 * Bull Board mount gate (EQS-01).
 *
 * Disabled in production unless `ENABLE_BULL_BOARD=true` — when disabled the
 * dashboard router and its placeholder controller are absent from the module
 * graph entirely (zero attack surface), not merely guarded. In non-production
 * it is mounted but still protected by `BullBoardAuthMiddleware` (SUPER_ADMIN
 * cookie auth).
 *
 * Read from `process.env` at module-construction time — this runs before
 * `EnvService` is injectable AND before `ConfigModule` loads the `.env` file.
 * Consequence: a production opt-in must be a **real process env var**
 * (Docker/k8s/shell/CI); `ENABLE_BULL_BOARD` placed only in the `.env` file
 * will NOT enable the dashboard in production. In non-production the dashboard
 * is enabled regardless of the flag, so the distinction is moot locally.
 * Documented in `.env.example` and the `env.ts` schema comment.
 */
const bullBoardEnabled = isBullBoardEnabled(
  process.env.NODE_ENV,
  process.env.ENABLE_BULL_BOARD,
  process.env.PROCESS_ROLE
)

// Secure default: render read-only unless an operator opts into write actions
// (ADR-047). Read from `process.env` at module-construction, like the mount gate.
const bullBoardReadOnly = isBullBoardReadOnly(process.env.BULL_BOARD_READ_ONLY)

const bullBoardImports = bullBoardEnabled
  ? [
      // Auth middleware runs before the mounted Bull Board router.
      BullBoardModule.forRootAsync({
        imports: [BullBoardAuthModule],
        inject: [BullBoardAuthService],
        useFactory: (auth: BullBoardAuthService) => ({
          route: '/admin/queues',
          adapter: ExpressAdapter,
          middleware: createBullBoardAuthMiddleware(auth),
        }),
      }),
      BullBoardModule.forFeature({
        name: QueueName.DEFAULT,
        adapter: BullMQAdapter,
        options: { readOnlyMode: bullBoardReadOnly },
      }),
      BullBoardModule.forFeature({
        name: QueueName.EMAIL,
        adapter: BullMQAdapter,
        options: { readOnlyMode: bullBoardReadOnly },
      }),
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

    // Register all queues
    BullModule.registerQueue({ name: QueueName.DEFAULT }, { name: QueueName.EMAIL }),

    // Bull Board dashboard — mounted + auth-protected only when enabled.
    ...bullBoardImports,
  ],
  controllers: bullBoardEnabled ? [DashboardController] : [],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
