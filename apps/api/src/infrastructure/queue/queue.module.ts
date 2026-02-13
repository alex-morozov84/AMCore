import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { BullBoardModule } from '@bull-board/nestjs'
import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { URL } from 'url'

import { QueueName } from './constants/queues.constant'
import { DashboardController } from './dashboard/dashboard.controller'
import { HelloWorldProcessor } from './processors/hello-world.processor'
import { QueueService } from './queue.service'

import { EnvModule } from '@/env/env.module'
import { EnvService } from '@/env/env.service'

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

    // Bull Board Dashboard
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),

    // Register queues in Bull Board
    BullBoardModule.forFeature({
      name: QueueName.DEFAULT,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueName.EMAIL,
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [DashboardController],
  providers: [QueueService, HelloWorldProcessor],
  exports: [QueueService],
})
export class QueueModule {}
