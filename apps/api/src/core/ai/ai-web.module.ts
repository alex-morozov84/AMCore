import { Module } from '@nestjs/common'

import { AiConversationService } from './conversations/ai-conversation.service'
import { AiConversationsController } from './conversations/ai-conversations.controller'
import { AiRunService } from './runs/ai-run.service'
import { AiRunProducerService } from './runs/ai-run-producer.service'
import { AiRunsController } from './runs/ai-runs.controller'

import { AiCatalogModule } from '@/infrastructure/ai/ai-catalog.module'
import { QueueModule } from '@/infrastructure/queue'
import { PrismaModule } from '@/prisma'

/**
 * AI HTTP surface (Track C — ADR-054, Arc C) — `web`/`all` roles only. The conversation + durable-
 * run producer/read endpoints. For AI infrastructure it imports **only** `AiCatalogModule` (the
 * secret-free `AiModelRegistry`, for the producer's model snapshot); it deliberately does **not**
 * import `AiGatewayModule`, so neither `ModelGateway` nor the provider adapters are resolvable from
 * the web DI graph — provider I/O is worker-only (the Arc B carried boundary, completed when the
 * worker slice wires `AiGatewayModule` in C.4). `QueueModule` supplies the `QueueService` that
 * enqueues the best-effort run wake; the worker consumes it.
 */
@Module({
  imports: [PrismaModule, AiCatalogModule, QueueModule],
  controllers: [AiConversationsController, AiRunsController],
  providers: [AiConversationService, AiRunProducerService, AiRunService],
})
export class AiWebModule {}
