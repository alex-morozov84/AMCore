import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { BullBoardModule } from '@bull-board/nestjs'
import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { URL } from 'url'

import { QueueName } from './constants/queues.constant'
import { createBullBoardAuthMiddleware } from './dashboard/bull-board-auth.middleware'
import { BullBoardAuthModule } from './dashboard/bull-board-auth.module'
import { BullBoardAuthService } from './dashboard/bull-board-auth.service'
import { isBullBoardEnabled } from './dashboard/bull-board-mount-gate'
import { DashboardController } from './dashboard/dashboard.controller'
import { HelloWorldProcessor } from './processors/hello-world.processor'
import { QueueService } from './queue.service'

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
const bullBoardEnabled = isBullBoardEnabled(process.env.NODE_ENV, process.env.ENABLE_BULL_BOARD)

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
      BullBoardModule.forFeature({ name: QueueName.DEFAULT, adapter: BullMQAdapter }),
      BullBoardModule.forFeature({ name: QueueName.EMAIL, adapter: BullMQAdapter }),
    ]
  : []

@Module({
  imports: [
    // Global BullMQ setup
    BullModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => {
        // Parse REDIS_URL from validated env
        const redisUrl = new URL(env.get('REDIS_URL'))

        return {
          connection: {
            host: redisUrl.hostname,
            port: parseInt(redisUrl.port, 10) || 6379,
            password: redisUrl.password || undefined,
            db: redisUrl.pathname ? parseInt(redisUrl.pathname.slice(1), 10) : 0,
          },
          prefix: 'amcore',
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential' as const,
              delay: 1000,
            },
            removeOnComplete: {
              age: 3600, // 1 hour
              count: 100,
            },
            removeOnFail: {
              age: 86400, // 24 hours
              count: 1000,
            },
          },
        }
      },
    }),

    // Register all queues
    BullModule.registerQueue({ name: QueueName.DEFAULT }, { name: QueueName.EMAIL }),

    // Bull Board dashboard — mounted + auth-protected only when enabled.
    ...bullBoardImports,
  ],
  controllers: bullBoardEnabled ? [DashboardController] : [],
  providers: [QueueService, HelloWorldProcessor],
  exports: [QueueService],
})
export class QueueModule {}
