import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AI_RUN_DISPATCH_CONCURRENCY } from './ai-run.constants'

import { CapacityGate, ShutdownLatch } from '@/infrastructure/worker-lifecycle'

/** DI tokens for the AI dispatcher's shutdown latch and capacity gate (instances, not singletons of the library). */
export const AI_RUN_SHUTDOWN_LATCH = 'AI_RUN_SHUTDOWN_LATCH'
export const AI_RUN_CAPACITY_GATE = 'AI_RUN_CAPACITY_GATE'

/** The AI run dispatcher's shutdown latch: the shared lifecycle latch bound to this subsystem. */
@Injectable()
export class AiRunShutdownLatch extends ShutdownLatch {
  constructor(logger: PinoLogger) {
    logger.setContext(AiRunShutdownLatch.name)
    super(logger, 'ai.run')
  }
}

/** The AI run dispatcher's capacity gate: the shared gate with this subsystem's lane count. */
export class AiRunCapacityGate extends CapacityGate {
  constructor(latch: ShutdownLatch, capacity: number = AI_RUN_DISPATCH_CONCURRENCY) {
    super(latch, capacity)
  }
}
