import { Module } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { EmailService } from './email.service'
import type { EmailProvider } from './email.types'
import { MockEmailProvider } from './providers/mock.provider'
import { ResendEmailProvider } from './providers/resend.provider'

import { EnvModule } from '@/env/env.module'
import { EnvService } from '@/env/env.service'
import { MetricsService, ObservabilityModule } from '@/infrastructure/observability'
import { QueueModule, QueueService } from '@/infrastructure/queue'

/**
 * Email Module
 *
 * Provides email sending functionality (the producer side — `EmailService`):
 * - Template rendering (React Email)
 * - Provider abstraction (Resend/Mock)
 * - Async delivery: enqueues onto BullMQ
 *
 * The BullMQ consumer (`EmailProcessor`) lives in `EmailWorkerModule`, imported
 * only by the worker/all process roots (ADR-041). This module is safe to import
 * from `web` — it never registers a worker.
 */
@Module({
  imports: [EnvModule, QueueModule, ObservabilityModule],
  providers: [
    // Dynamic provider selection based on env
    {
      provide: 'EmailProvider',
      inject: [EnvService, PinoLogger],
      useFactory: (env: EnvService, logger: PinoLogger): EmailProvider => {
        const provider = env.get('EMAIL_PROVIDER')

        switch (provider) {
          case 'resend':
            return new ResendEmailProvider(env, logger)
          case 'mock':
          default:
            return new MockEmailProvider(logger)
        }
      },
    },
    // Email service
    {
      provide: EmailService,
      inject: ['EmailProvider', QueueService, EnvService, PinoLogger, MetricsService],
      useFactory: (
        emailProvider: EmailProvider,
        queueService: QueueService,
        env: EnvService,
        logger: PinoLogger,
        metrics: MetricsService
      ) => {
        return new EmailService(emailProvider, queueService, env, logger, metrics)
      },
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
