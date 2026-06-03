import { Module } from '@nestjs/common'

import { appProviders, coreImports, workerImports } from './app-imports'

/**
 * Root module for `PROCESS_ROLE=worker` (ADR-041): BullMQ processors + cron, plus
 * only the health endpoints (`HealthModule` is in core). It deliberately omits
 * the business controller modules (`webImports`) and Bull Board, so the worker
 * exposes a health-only HTTP surface for k8s probes and routes no business API.
 */
@Module({
  imports: [...coreImports(), ...workerImports],
  providers: appProviders,
})
export class WorkerModule {}
