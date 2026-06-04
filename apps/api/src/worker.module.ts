import { Module } from '@nestjs/common'

import { appProviders, coreImports, workerImports } from './app-imports'

/**
 * Root module for `PROCESS_ROLE=worker` (ADR-041): BullMQ processors + cron, plus
 * only the health + metrics endpoints (`HealthModule` and `ObservabilityModule`
 * are in core). It deliberately omits
 * the business controller modules (`webImports`) and Bull Board, so the worker
 * exposes a probe/scrape-only HTTP surface and routes no business API.
 */
@Module({
  imports: [...coreImports(), ...workerImports],
  providers: appProviders,
})
export class WorkerModule {}
