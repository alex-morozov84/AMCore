import { Module } from '@nestjs/common'

import { appProviders, coreImports, webImports, workerImports } from './app-imports'

/**
 * Root module for `PROCESS_ROLE=all` (dev / single-node): HTTP API + BullMQ
 * worker + cron in one process — today's behaviour. `web` and `worker` use
 * `WebModule` / `WorkerModule` (ADR-041). Tests import this directly (= `all`).
 */
@Module({
  imports: [...coreImports(), ...webImports, ...workerImports],
  providers: appProviders,
})
export class AppModule {}
