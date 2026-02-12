import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { BullBoardModule } from '@bull-board/nestjs'
import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { QueueName } from './constants/queues.constant'
import { DashboardController } from './dashboard/dashboard.controller'
import { HelloWorldProcessor } from './processors/hello-world.processor'
import queueConfig from './queue.config'
import { QueueService } from './queue.service'

@Module({
  imports: [
    // Load queue configuration
    ConfigModule.forFeature(queueConfig),

    // Global BullMQ setup
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: configService.getOrThrow('queue.redis'),
        prefix: configService.getOrThrow('queue.prefix'),
        defaultJobOptions: configService.getOrThrow('queue.defaultJobOptions'),
      }),
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
