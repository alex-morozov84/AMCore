import type { Job } from 'bullmq'

import { AiRunDispatchProcessor } from './ai-run-dispatch.processor'
import type { AiRunDispatchService } from './ai-run-dispatch.service'

import type { MetricsService } from '@/infrastructure/observability'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'

/**
 * Unit tests for the AI run BullMQ processor (Track C — ADR-054, Arc C.4). A wake is a hint: it
 * drains all due runs regardless of the payload, ignores unknown job types, and surfaces a failed
 * wake as a dead-letter metric (the recovery cron re-drains).
 */

function job(over: Partial<Job> = {}): Job {
  return { id: 'j1', name: JobName.AI_RUN_WAKE, data: { runId: 'run-1' }, ...over } as Job
}

describe('AiRunDispatchProcessor', () => {
  let dispatch: { drainDueBatches: jest.Mock }
  let metrics: { incQueueEvent: jest.Mock; incRedisClientEvent: jest.Mock }
  let processor: AiRunDispatchProcessor
  const logger = { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    dispatch = { drainDueBatches: jest.fn().mockResolvedValue(undefined) }
    metrics = { incQueueEvent: jest.fn(), incRedisClientEvent: jest.fn() }
    processor = new AiRunDispatchProcessor(
      dispatch as unknown as AiRunDispatchService,
      logger as never,
      metrics as unknown as MetricsService
    )
  })

  it('drains due runs on a valid wake job', async () => {
    await processor.process(job())
    expect(dispatch.drainDueBatches).toHaveBeenCalledTimes(1)
  })

  it('skips an unknown job type without draining', async () => {
    await processor.process(job({ name: 'something-else' }))
    expect(dispatch.drainDueBatches).not.toHaveBeenCalled()
  })

  it('drains anyway when the payload is invalid (wake carries no work)', async () => {
    await processor.process(job({ data: { runId: 42 } as unknown as Job['data'] }))
    expect(dispatch.drainDueBatches).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('records a dead-letter metric when a wake job fails', () => {
    processor.onFailed(job(), new Error('drain threw'))
    expect(metrics.incQueueEvent).toHaveBeenCalledWith(QueueName.AI_RUNS, 'dead_letter')
  })

  it('records a worker error on a Redis/connection error', () => {
    processor.onError(new Error('conn reset'))
    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('queue_worker', 'error')
    expect(metrics.incQueueEvent).toHaveBeenCalledWith(QueueName.AI_RUNS, 'worker_error')
  })
})
