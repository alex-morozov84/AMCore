import { Module } from '@nestjs/common'

import { appProviders, coreImports, webImports } from './app-imports'

/**
 * Root module for `PROCESS_ROLE=web` (ADR-041): HTTP API + queue producers, but
 * NO BullMQ worker and NO scheduler — those live in `workerImports`. `web` can
 * enqueue jobs (via `EmailService` / `QueueService` in core) for a worker to run.
 */
@Module({
  imports: [...coreImports(), ...webImports],
  providers: appProviders,
})
export class WebModule {}
