import { Module } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { EmailService } from './email.service'
import type { EmailProvider } from './email.types'
import { EmailProcessor } from './processors/email.processor'
import { MockEmailProvider } from './providers/mock.provider'
import { ResendEmailProvider } from './providers/resend.provider'

import { EnvModule } from '@/env/env.module'
import { EnvService } from '@/env/env.service'
import { QueueModule, QueueService } from '@/infrastructure/queue'

/**
 * Email Module
 *
 * Provides email sending functionality with:
 * - Template rendering (React Email)
 * - Provider abstraction (Resend/Mock)
 * - Async delivery (BullMQ)
 */
@Module({
  imports: [EnvModule, QueueModule],
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
      inject: ['EmailProvider', QueueService, EnvService, PinoLogger],
      useFactory: (
        emailProvider: EmailProvider,
        queueService: QueueService,
        env: EnvService,
        logger: PinoLogger
      ) => {
        return new EmailService(emailProvider, queueService, env, logger)
      },
    },
    // BullMQ processor
    EmailProcessor,
  ],
  exports: [EmailService],
})
export class EmailModule {}
