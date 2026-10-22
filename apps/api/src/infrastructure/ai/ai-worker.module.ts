import { Module } from '@nestjs/common'

import { AiRealtimeModule } from '../../core/ai/realtime/ai-realtime.module.js'
import { AuditModule } from '../../core/audit/index.js'
import { PrismaModule } from '../../prisma/index.js'
import { bindWorkHandlers } from '../background-work/registration.js'
import { ScheduledJobsModule } from '../schedule/scheduled-jobs.module.js'

import { AiCatalogModule } from './ai-catalog.module.js'
import { AiGatewayModule } from './ai-gateway.module.js'
import { AiApprovalExpiryService } from './runs/ai-approval-expiry.service.js'
import { AiRunRepository } from './runs/ai-run.repository.js'
import { AiRunApprovalParker } from './runs/ai-run-approval-parker.service.js'
import { AiRunBacklogCollector } from './runs/ai-run-backlog.collector.js'
import { AiRunDispatchProcessor } from './runs/ai-run-dispatch.processor.js'
import { AiRunDispatchService } from './runs/ai-run-dispatch.service.js'
import { AiRunExecutorService } from './runs/ai-run-executor.service.js'
import { AiRunGuard } from './runs/ai-run-guard.service.js'
import { AiRunLoopExecutor } from './runs/ai-run-loop-executor.service.js'
import { AiRunLoopFinalizer } from './runs/ai-run-loop-finalizer.service.js'
import { AiRunRecoveryService } from './runs/ai-run-recovery.service.js'
import {
  AI_RUN_CAPACITY_GATE,
  AI_RUN_SHUTDOWN_LATCH,
  AiRunCapacityGate,
  AiRunShutdownLatch,
} from './runs/ai-run-shutdown.js'
import { AiRunTransitions } from './runs/ai-run-transitions.service.js'
import { aiRunsWork } from './runs/ai-runs.work.js'
import { AiToolActionService } from './runs/ai-tool-action.service.js'
import { AiToolRecoveryService } from './runs/ai-tool-recovery.service.js'
import { AiToolsModule } from './tools/ai-tools.module.js'

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
  imports: [
    AiCatalogModule,
    AiGatewayModule,
    PrismaModule,
    AiRealtimeModule,
    AiToolsModule,
    AuditModule,
    ScheduledJobsModule,
  ],
  providers: [
    AiRunRepository,
    AiRunBacklogCollector,
    AiRunExecutorService,
    AiRunLoopExecutor,
    AiRunLoopFinalizer,
    AiRunApprovalParker,
    AiApprovalExpiryService,
    AiToolActionService,
    AiToolRecoveryService,
    AiRunGuard,
    AiRunTransitions,
    AiRunShutdownLatch,
    { provide: AI_RUN_SHUTDOWN_LATCH, useExisting: AiRunShutdownLatch },
    {
      provide: AI_RUN_CAPACITY_GATE,
      useFactory: (latch: AiRunShutdownLatch): AiRunCapacityGate => new AiRunCapacityGate(latch),
      inject: [AiRunShutdownLatch],
    },
    AiRunDispatchService,
    AiRunDispatchProcessor,
    AiRunRecoveryService,
  ],
  exports: [AiRunDispatchProcessor],
})
class AiRunImplementationModule {}

const bindings = bindWorkHandlers(aiRunsWork, { 'ai-run-wake@1': AiRunDispatchProcessor }, [
  AiRunImplementationModule,
])
@Module({ imports: [AiRunImplementationModule, bindings], exports: [bindings] })
export class AiWorkerModule {}
