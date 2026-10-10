import { type Job, UnrecoverableError } from 'bullmq'
import type { PinoLogger } from 'nestjs-pino'

import type { EmailService } from './email.service'
import { EmailTemplate } from './email.types'
import { QueuedEmailHandler } from './queued-email.handler'

import type { MetricsService } from '@/infrastructure/observability'

describe('registered email worker failure observability', () => {
  const metrics = {
    incQueueEvent: jest.fn(),
    incEmailDeadLetter: jest.fn(),
    incRedisClientEvent: jest.fn(),
  }
  const logger = { error: jest.fn() }
  const handler = new QueuedEmailHandler(
    {} as EmailService,
    metrics as unknown as MetricsService,
    logger as unknown as PinoLogger
  )
  const job = (attemptsMade: number, payload: unknown): Job =>
    ({
      id: 'safe-id',
      attemptsMade,
      opts: { attempts: 3 },
      data: { protocolVersion: 1, payload },
    }) as Job

  beforeEach(() => jest.clearAllMocks())

  it('counts terminal failures only and never logs payload or exception content', () => {
    const payload = {
      template: EmailTemplate.WELCOME,
      to: 'private@example.test',
      secret: 'sensitive...',
    }
    handler.onFailed(job(1, payload), new Error('private provider response...'))
    expect(logger.error).not.toHaveBeenCalled()
    handler.onFailed(job(3, payload), new Error('private provider response...'))
    expect(metrics.incEmailDeadLetter).toHaveBeenCalledWith(EmailTemplate.WELCOME, false)
    handler.onFailed(job(1, null), new UnrecoverableError('private renderer response...'))
    expect(metrics.incEmailDeadLetter).toHaveBeenCalledWith('unknown', true)
    expect(metrics.incQueueEvent).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(
      /private|sensitive|renderer|provider response/
    )
  })

  it('reports worker connection errors with bounded labels and no transport exception', () => {
    handler.onError()
    expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('queue_worker', 'error')
    expect(metrics.incQueueEvent).toHaveBeenCalledWith('email', 'worker_error')
    expect(logger.error.mock.calls[0]?.[0]).toEqual({ event: 'queue.worker_error' })
  })

  it('turns deterministic preparation failure into a safe unrecoverable reason', async () => {
    const prepareQueuedRequest = jest.fn().mockRejectedValue(new Error('private render payload...'))
    const preparing = new QueuedEmailHandler(
      { prepareQueuedRequest } as unknown as EmailService,
      metrics as unknown as MetricsService,
      logger as unknown as PinoLogger
    )
    await expect(
      preparing.prepareRequest({ template: EmailTemplate.WELCOME })
    ).rejects.toMatchObject({ name: 'UnrecoverableError', message: 'PERMANENT_FAILURE' })
    expect(prepareQueuedRequest).toHaveBeenCalledTimes(1)
    expect(logger.error).not.toHaveBeenCalled()
  })
})
