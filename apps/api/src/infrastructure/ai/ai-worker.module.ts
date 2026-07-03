import { Module } from '@nestjs/common'

import { AiGatewayModule } from './ai-gateway.module'
import { AiRunRepository } from './runs/ai-run.repository'
import { AiRunDispatchProcessor } from './runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from './runs/ai-run-dispatch.service'
import { AiRunExecutorService } from './runs/ai-run-executor.service'
import { AiRunRecoveryService } from './runs/ai-run-recovery.service'

import { AiRealtimeModule } from '@/core/ai/realtime/ai-realtime.module'
import { PrismaModule } from '@/prisma'

/**
 * AI worker slice (Track C — ADR-054, Arc C.4) — `worker`/`all` roles only. Houses the durable run
 * repository/state machine, the executor (the only provider-I/O caller), the dispatch/drain service,
 * the BullMQ `@Processor` for `QueueName.AI_RUNS`, and the recovery `@Cron`.
 *
 * It imports the **worker-only `AiGatewayModule`** (the `ModelGateway` seam + SDK adapters +
 * credential resolver). Because this module is wired into `workerImports` only — never
 * `coreImports()`/web — the web DI graph can neither resolve `ModelGateway`/adapters/executor nor
 * run the processor or cron: the ADR-041 process-role boundary is enforced by DI, not convention.
 * The `QueueName.AI_RUNS` queue itself is registered globally in `QueueModule` (a producer for web,
 * a consumer here); `PrismaService`/`MetricsService` are global and `PinoLogger` comes from the root
 * logger module. `AiRealtimeModule` supplies the content-free `AiRunRealtimePublisher` the executor
 * uses to emit status hints (the SSE receive side is web-only, in `AiWebModule`).
 */
@Module({
  imports: [AiGatewayModule, PrismaModule, AiRealtimeModule],
  providers: [
    AiRunRepository,
    AiRunExecutorService,
    AiRunDispatchService,
    AiRunDispatchProcessor,
    AiRunRecoveryService,
  ],
})
export class AiWorkerModule {}
