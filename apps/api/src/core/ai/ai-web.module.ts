import { Module } from '@nestjs/common'

import { AiAssistantAdminController } from './admin/ai-assistant-admin.controller'
import { AiAssistantAdminService } from './admin/ai-assistant-admin.service'
import { AiApprovalService } from './approvals/ai-approval.service'
import { AiApprovalsController } from './approvals/ai-approvals.controller'
import { AiArtifactUploadService } from './artifacts/ai-artifact-upload.service'
import { AiArtifactsController } from './artifacts/ai-artifacts.controller'
import { AiConversationService } from './conversations/ai-conversation.service'
import { AiConversationControlController } from './conversations/ai-conversation-control.controller'
import { AiConversationControlService } from './conversations/ai-conversation-control.service'
import { AiConversationOperatorService } from './conversations/ai-conversation-operator.service'
import { AiConversationsController } from './conversations/ai-conversations.controller'
import { AiRunRealtimeHub } from './realtime/ai-run-realtime.hub'
import { AiRunRealtimeSubscriber } from './realtime/ai-run-realtime.subscriber'
import { AiRunStreamController } from './realtime/ai-run-stream.controller'
import { AiRunService } from './runs/ai-run.service'
import { AiRunProducerService } from './runs/ai-run-producer.service'
import { AiRunsController } from './runs/ai-runs.controller'

import { AuditModule } from '@/core/audit'
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
 *
 * The status-only realtime run stream (Arc C.5, ADR-053 pattern) is hosted here — web/all only: the
 * SSE `AiRunStreamController`, the process-local `AiRunRealtimeHub`, and the dedicated Redis
 * `AiRunRealtimeSubscriber` that fans worker-published hints out to open streams. The publisher is
 * worker-side (`AiRealtimeModule` in `AiWorkerModule`); no provider-call capability is added here.
 */
@Module({
  imports: [PrismaModule, AiCatalogModule, QueueModule, AuditModule],
  controllers: [
    AiConversationsController,
    AiConversationControlController,
    AiRunsController,
    AiRunStreamController,
    AiApprovalsController,
    AiAssistantAdminController,
    AiArtifactsController,
  ],
  providers: [
    AiConversationService,
    AiConversationControlService,
    AiConversationOperatorService,
    AiRunProducerService,
    AiRunService,
    AiApprovalService,
    AiAssistantAdminService,
    AiRunRealtimeHub,
    AiRunRealtimeSubscriber,
    AiArtifactUploadService,
  ],
})
export class AiWebModule {}
