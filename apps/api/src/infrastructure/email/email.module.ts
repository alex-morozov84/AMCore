import { Module } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { EnvModule } from '../../env/env.module.js'
import { EnvService } from '../../env/env.service.js'
import { ControlConnection } from '../background-work/control-connection.js'
import { MetricsService, ObservabilityModule } from '../observability/index.js'
import { QueueModule, QueueService } from '../queue/index.js'

import { EmailService } from './email.service.js'
import type { EmailProvider } from './email.types.js'
import { MockEmailProvider } from './providers/mock.provider.js'
import { ResendEmailProvider } from './providers/resend.provider.js'

/**
 * Email Module
 *
 * Provides email sending functionality (the producer side — `EmailService`):
 * - Template rendering (React Email)
 * - Provider abstraction (Resend/Mock)
 * - Async delivery: enqueues onto BullMQ
 *
 * The shared runtime loads `EmailWorkerModule` handler bindings only for
 * worker/all roots. This module is safe to import from web and does not register
 * a worker or a separate control-connection pool.
 */
@Module({
  imports: [EnvModule, QueueModule, ObservabilityModule],
  providers: [
    // Dynamic provider selection based on env
    {
      provide: 'EmailProvider',
      inject: [EnvService, PinoLogger, ControlConnection],
      useFactory: (
        env: EnvService,
        logger: PinoLogger,
        control: ControlConnection
      ): EmailProvider => {
        const provider = env.get('EMAIL_PROVIDER')

        switch (provider) {
          case 'resend':
            return new ResendEmailProvider(env, logger)
          case 'mock':
          default:
            return new MockEmailProvider(logger, env, control)
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
  exports: [EmailService, 'EmailProvider'],
})
export class EmailModule {}
