import { Module } from '@nestjs/common'

import { AiCatalogModule } from '../../infrastructure/ai/ai-catalog.module.js'
import { AiToolContractsModule } from '../../infrastructure/ai/tools/ai-tool-contracts.module.js'
import { QueueModule } from '../../infrastructure/queue/index.js'
import { PrismaModule } from '../../prisma/index.js'
import { AuditModule } from '../audit/index.js'

import { AiAssistantAdminController } from './admin/ai-assistant-admin.controller.js'
import { AiAssistantAdminService } from './admin/ai-assistant-admin.service.js'
import { AiApprovalService } from './approvals/ai-approval.service.js'
import { AiApprovalsController } from './approvals/ai-approvals.controller.js'
import { AiArtifactDownloadService } from './artifacts/ai-artifact-download.service.js'
import { AiArtifactUploadService } from './artifacts/ai-artifact-upload.service.js'
import { AiArtifactsController } from './artifacts/ai-artifacts.controller.js'
import { AiConversationService } from './conversations/ai-conversation.service.js'
import { AiConversationAccessAuthorizer } from './conversations/ai-conversation-access.authorizer.js'
import { AiConversationControlController } from './conversations/ai-conversation-control.controller.js'
import { AiConversationControlService } from './conversations/ai-conversation-control.service.js'
import { AiConversationOperatorService } from './conversations/ai-conversation-operator.service.js'
import { AiConversationsController } from './conversations/ai-conversations.controller.js'
import { AiRunRealtimeHub } from './realtime/ai-run-realtime.hub.js'
import { AiRunRealtimeSubscriber } from './realtime/ai-run-realtime.subscriber.js'
import { AiRunStreamController } from './realtime/ai-run-stream.controller.js'
import { AiRunService } from './runs/ai-run.service.js'
import { AiRunProducerService } from './runs/ai-run-producer.service.js'
import { AiRunsController } from './runs/ai-runs.controller.js'

/**
 * AI HTTP surface (Track C — ADR-054, Arc C) — `web`/`all` roles only. The conversation + durable-
 * run producer/read endpoints. AI infrastructure provides `AiCatalogModule` for model snapshots
 * and `AiToolContractsModule` for inert contracts and headless domain authorities. It does **not**
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
  imports: [PrismaModule, AiCatalogModule, QueueModule, AuditModule, AiToolContractsModule],
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
    AiConversationAccessAuthorizer,
    AiConversationControlService,
    AiConversationOperatorService,
    AiRunProducerService,
    AiRunService,
    AiApprovalService,
    AiAssistantAdminService,
    AiRunRealtimeHub,
    AiRunRealtimeSubscriber,
    AiArtifactUploadService,
    AiArtifactDownloadService,
  ],
})
export class AiWebModule {}
