import { Module } from '@nestjs/common'

import { EmailModule } from './email.module'
import { EmailProcessor } from './processors/email.processor'

/**
 * Email worker module (ADR-041).
 *
 * Registers the BullMQ `EmailProcessor`. `@nestjs/bullmq` creates a `Worker` for
 * any discovered `@Processor` provider, so the processor lives here — imported
 * only by the `worker`/`all` process roots, never by `web`. That keeps `web` a
 * pure producer (it imports `EmailModule` for `EmailService` only).
 */
@Module({
  imports: [EmailModule],
  providers: [EmailProcessor],
})
export class EmailWorkerModule {}
