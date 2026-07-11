import { Module } from '@nestjs/common'

import { AiGatewayModule } from './ai-gateway.module'
import { AiApprovalExpiryService } from './runs/ai-approval-expiry.service'
import { AiRunRepository } from './runs/ai-run.repository'
import { AiRunApprovalParker } from './runs/ai-run-approval-parker.service'
import { AiRunDispatchProcessor } from './runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from './runs/ai-run-dispatch.service'
import { AiRunExecutorService } from './runs/ai-run-executor.service'
import { AiRunLoopExecutor } from './runs/ai-run-loop-executor.service'
import { AiRunLoopFinalizer } from './runs/ai-run-loop-finalizer.service'
import { AiRunRecoveryService } from './runs/ai-run-recovery.service'
import { AiToolDispatcher } from './runs/ai-tool-dispatcher.service'
import { AiToolsModule } from './tools/ai-tools.module'

import { AiRealtimeModule } from '@/core/ai/realtime/ai-realtime.module'
import { AuditModule } from '@/core/audit'
import { PrismaModule } from '@/prisma'

/**
 * AI worker slice (Track C — ADR-054, Arc C.4) — `worker`/`all` roles only. Houses the durable run
 * repository/state machine, the executor (the only provider-I/O caller), the dispatch/drain service,
 * the BullMQ `@Processor` for `QueueName.AI_RUNS`, and the recovery `@Cron`.
 *
 * It imports the **worker-only `AiGatewayModule`** (the `ModelGateway` seam + SDK adapters +
 * credential resolver) and, for the Arc E bounded tool loop, the worker-only `AiToolsModule` (the
 * code-owned tool registry) + the `AuditModule` (content-free tool-execution audit). Because this
 * module is wired into `workerImports` only — never `coreImports()`/web — the web DI graph can neither
 * resolve `ModelGateway`/adapters/executor/loop nor the tool registry/dispatcher nor run the processor
 * or cron: the ADR-041 process-role boundary is enforced by DI, not convention. The `QueueName.AI_RUNS`
 * queue is registered globally in `QueueModule`; `PrismaService`/`MetricsService` are global and
 * `PinoLogger` comes from the root logger module. `AiRealtimeModule` supplies the content-free
 * `AiRunRealtimePublisher` the executor uses to emit status hints (the SSE receive side is web-only).
 */
@Module({
  imports: [AiGatewayModule, PrismaModule, AiRealtimeModule, AiToolsModule, AuditModule],
  providers: [
    AiRunRepository,
    AiRunExecutorService,
    AiRunLoopExecutor,
    AiRunLoopFinalizer,
    AiRunApprovalParker,
    AiApprovalExpiryService,
    AiToolDispatcher,
    AiRunDispatchService,
    AiRunDispatchProcessor,
    AiRunRecoveryService,
  ],
})
export class AiWorkerModule {}
