import { Module } from '@nestjs/common'

import { AiRunRealtimePublisher } from './ai-run-realtime.publisher'

/**
 * AI realtime publisher module (Track C — ADR-054, Arc C.5; ADR-053 pattern). Provides and exports
 * only the content-free `AiRunRealtimePublisher`, which publishes status hints on the shared
 * (global) Redis client. It is safe in any role; in Arc C.5 the **worker** imports it to publish run
 * transitions. The receive side — the dedicated Redis subscriber, the process-local hub, and the SSE
 * controller — is web/all only and lives in `AiWebModule`, so the worker never gains stream-hosting
 * capability and the web never needs the publisher for the worker-driven lifecycle.
 */
@Module({
  providers: [AiRunRealtimePublisher],
  exports: [AiRunRealtimePublisher],
})
export class AiRealtimeModule {}
