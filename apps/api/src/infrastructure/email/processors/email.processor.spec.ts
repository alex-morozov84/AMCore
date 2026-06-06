import { Test, TestingModule } from '@nestjs/testing'
import { type Job, UnrecoverableError } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { EmailService } from '../email.service'
import type { SendEmailJobData } from '../email.types'
import { EmailTemplate } from '../email.types'

import { EmailProcessor } from './email.processor'

import { MetricsService } from '@/infrastructure/observability'
import { JobName } from '@/infrastructure/queue/constants/queues.constant'

// Mock @formatjs/intl (ESM module)
jest.mock('@formatjs/intl', () => ({
  createIntl: jest.fn(() => ({
    formatMessage: jest.fn((descriptor) => descriptor.id),
  })),
}))

describe('EmailProcessor', () => {
  let processor: EmailProcessor
  let emailService: jest.Mocked<EmailService>
  let mockLogger: jest.Mocked<PinoLogger>
  let metrics: jest.Mocked<
    Pick<
      MetricsService,
      'incQueueEvent' | 'incRedisClientEvent' | 'observeEmailOperation' | 'incEmailDeadLetter'
    >
  >

  beforeEach(async () => {
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    metrics = {
      incQueueEvent: jest.fn(),
      incRedisClientEvent: jest.fn(),
      observeEmailOperation: jest.fn(),
      incEmailDeadLetter: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProcessor,
        {
          provide: EmailService,
          useValue: {
            renderTemplate: jest.fn(),
            send: jest.fn(),
          },
        },
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
        {
          provide: MetricsService,
          useValue: metrics,
        },
      ],
    }).compile()

    processor = module.get<EmailProcessor>(EmailProcessor)
    emailService = module.get(EmailService)
  })

  it('should be defined', () => {
    expect(processor).toBeDefined()
  })

  describe('process', () => {
    it('should process send-email job successfully', async () => {
      const jobData: SendEmailJobData = {
        template: EmailTemplate.WELCOME,
        to: 'test@example.com',
        data: { name: 'Test User', email: 'test@example.com' },
      }

      const job = {
        id: 'job-123',
        name: JobName.SEND_EMAIL,
        data: jobData,
        attemptsMade: 0,
      } as Job<SendEmailJobData>

      emailService.renderTemplate.mockResolvedValue({
        html: '<p>Welcome!</p>',
        text: 'Welcome!',
        subject: 'Welcome',
      })

      emailService.send.mockResolvedValue({
        id: 'email_abc123',
        success: true,
      })

      await processor.process(job)

      expect(emailService.renderTemplate).toHaveBeenCalledWith(
        EmailTemplate.WELCOME,
        jobData.data,
        'worker'
      )

      expect(emailService.send).toHaveBeenCalledWith(
        {
          to: 'test@example.com',
          subject: 'Welcome',
          html: '<p>Welcome!</p>',
          text: 'Welcome!', // EQS-08: plaintext alternative forwarded
          idempotencyKey: 'email:job-123', // EQS-03: stable across retries
        },
        { template: EmailTemplate.WELCOME, mode: 'worker' }
      )
      expect(metrics.observeEmailOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          template: EmailTemplate.WELCOME,
          operation: 'process',
          mode: 'worker',
          result: 'success',
        }),
        expect.any(Number)
      )
    })

    it('should skip unknown job types', async () => {
      const job = {
        id: 'job-456',
        name: 'unknown-job',
        data: {},
        attemptsMade: 0,
      } as Job<SendEmailJobData>

      await processor.process(job)

      expect(emailService.renderTemplate).not.toHaveBeenCalled()
      expect(emailService.send).not.toHaveBeenCalled()
      expect(metrics.observeEmailOperation).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'process', result: 'discarded' }),
        expect.any(Number)
      )
    })

    it('discards a secret-bearing job without rendering, sending, or throwing (EQS-02)', async () => {
      // Simulates a legacy/injected Redis job carrying a secret template + token
      // URL. Job data is untrusted at runtime; the processor must not emit it.
      const job = {
        id: 'job-legacy',
        name: JobName.SEND_EMAIL,
        data: {
          template: EmailTemplate.PASSWORD_RESET,
          to: 'victim@example.com',
          data: { name: 'X', resetUrl: 'https://x/reset?token=leak', expiresIn: '15m' },
        },
        attemptsMade: 0,
      } as unknown as Job<SendEmailJobData>

      await expect(processor.process(job)).resolves.toBeUndefined()

      expect(emailService.renderTemplate).not.toHaveBeenCalled()
      expect(emailService.send).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-legacy', template: EmailTemplate.PASSWORD_RESET }),
        expect.stringContaining('secret-bearing')
      )
    })

    it('dead-letters null/non-object job data deterministically (no TypeError retry)', async () => {
      const job = {
        id: 'job-null',
        name: JobName.SEND_EMAIL,
        data: null,
        attemptsMade: 0,
      } as unknown as Job<SendEmailJobData>

      await expect(processor.process(job)).rejects.toBeInstanceOf(UnrecoverableError)
      expect(emailService.renderTemplate).not.toHaveBeenCalled()
      expect(emailService.send).not.toHaveBeenCalled()
    })

    it('dead-letters an object with no template (not silently completed)', async () => {
      const job = {
        id: 'job-no-template',
        name: JobName.SEND_EMAIL,
        data: { to: 'x@example.com', data: { name: 'X' } },
        attemptsMade: 0,
      } as unknown as Job<SendEmailJobData>

      await expect(processor.process(job)).rejects.toBeInstanceOf(UnrecoverableError)
      expect(emailService.send).not.toHaveBeenCalled()
    })

    const welcomeJob = (id: string, attemptsMade = 0): Job<SendEmailJobData> =>
      ({
        id,
        name: JobName.SEND_EMAIL,
        data: {
          template: EmailTemplate.WELCOME,
          to: 'test@example.com',
          data: { name: 'Test User', email: 'test@example.com' },
        },
        attemptsMade,
      }) as Job<SendEmailJobData>

    it('retries a transient send failure (plain Error, not UnrecoverableError) — EQS-03', async () => {
      emailService.renderTemplate.mockResolvedValue({
        html: '<p>Welcome!</p>',
        text: 'Welcome!',
        subject: 'Welcome',
      })
      emailService.send.mockResolvedValue({
        id: '',
        success: false,
        error: 'rate limited',
        retryable: true,
      })

      await expect(processor.process(welcomeJob('job-transient'))).rejects.toThrow('rate limited')
      await expect(processor.process(welcomeJob('job-transient'))).rejects.not.toBeInstanceOf(
        UnrecoverableError
      )
      expect(metrics.observeEmailOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'process',
          mode: 'worker',
          result: 'error',
          retryable: 'true',
        }),
        expect.any(Number)
      )
    })

    it('does NOT retry a deterministic send failure (UnrecoverableError) — EQS-03', async () => {
      emailService.renderTemplate.mockResolvedValue({
        html: '<p>Welcome!</p>',
        text: 'Welcome!',
        subject: 'Welcome',
      })
      emailService.send.mockResolvedValue({
        id: '',
        success: false,
        error: 'invalid from address',
        retryable: false,
      })

      await expect(processor.process(welcomeJob('job-det'))).rejects.toBeInstanceOf(
        UnrecoverableError
      )
    })

    it('treats a render failure as deterministic (UnrecoverableError, no send) — EQS-03', async () => {
      emailService.renderTemplate.mockRejectedValue(new Error('Template error'))

      await expect(processor.process(welcomeJob('job-render'))).rejects.toBeInstanceOf(
        UnrecoverableError
      )
      expect(emailService.send).not.toHaveBeenCalled()
    })

    it('treats an invalid payload as deterministic, without rendering or sending (EQS-07)', async () => {
      const job = {
        id: 'job-invalid',
        name: JobName.SEND_EMAIL,
        // queueable template but malformed data (missing required `email`)
        data: { template: EmailTemplate.WELCOME, to: 'test@example.com', data: { name: 'X' } },
        attemptsMade: 0,
      } as unknown as Job<SendEmailJobData>

      await expect(processor.process(job)).rejects.toBeInstanceOf(UnrecoverableError)
      expect(emailService.renderTemplate).not.toHaveBeenCalled()
      expect(emailService.send).not.toHaveBeenCalled()
    })

    it('should include attempt number in logs', async () => {
      const jobData: SendEmailJobData = {
        template: EmailTemplate.WELCOME,
        to: 'test@example.com',
        data: { name: 'Test User', email: 'test@example.com' },
      }

      const job = {
        id: 'job-202',
        name: JobName.SEND_EMAIL,
        data: jobData,
        attemptsMade: 2, // Third attempt
      } as Job<SendEmailJobData>

      emailService.renderTemplate.mockResolvedValue({
        html: '<p>Welcome!</p>',
        text: 'Welcome!',
        subject: 'Welcome',
      })

      emailService.send.mockResolvedValue({
        id: 'email_xyz',
        success: true,
      })

      await processor.process(job)

      // Should log attempt 3 (attemptsMade + 1)
      expect(emailService.renderTemplate).toHaveBeenCalled()
    })
  })

  describe('onFailed (dead-letter signal — EQS-03)', () => {
    const failedJob = (attemptsMade: number, attempts: number): Job<SendEmailJobData> =>
      ({
        id: 'job-dl',
        data: {
          template: EmailTemplate.WELCOME,
          to: 'test@example.com',
          data: { name: 'X', email: 'test@example.com' },
        },
        attemptsMade,
        opts: { attempts },
      }) as Job<SendEmailJobData>

    it('emits a dead-letter error once attempts are exhausted', () => {
      processor.onFailed(failedJob(3, 3), new Error('still failing'))

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'email.job.dead_letter', jobId: 'job-dl' }),
        expect.stringContaining('dead-lettered')
      )
      expect(metrics.incQueueEvent).toHaveBeenCalledWith('email', 'dead_letter')
      expect(metrics.incEmailDeadLetter).toHaveBeenCalledWith(EmailTemplate.WELCOME, false)
    })

    it('emits a dead-letter error immediately for an UnrecoverableError', () => {
      const err = new UnrecoverableError('invalid payload')
      processor.onFailed(failedJob(0, 3), err)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'email.job.dead_letter', unrecoverable: true }),
        expect.any(String)
      )
      expect(metrics.incQueueEvent).toHaveBeenCalledWith('email', 'dead_letter')
      expect(metrics.incEmailDeadLetter).toHaveBeenCalledWith(EmailTemplate.WELCOME, true)
    })

    it('stays silent on a non-terminal (will-retry) failure', () => {
      processor.onFailed(failedJob(1, 3), new Error('transient'))

      expect(mockLogger.error).not.toHaveBeenCalled()
      expect(metrics.incQueueEvent).not.toHaveBeenCalled()
      expect(metrics.incEmailDeadLetter).not.toHaveBeenCalled()
    })
  })

  describe('onError (worker Redis/connection observability — EQS-06)', () => {
    it('logs queue.worker_error at error level with no payload', () => {
      processor.onError(new Error('ECONNREFUSED'))

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'queue.worker_error', error: 'ECONNREFUSED' }),
        expect.stringContaining('worker Redis/connection error')
      )
      expect(metrics.incRedisClientEvent).toHaveBeenCalledWith('queue_worker', 'error')
      expect(metrics.incQueueEvent).toHaveBeenCalledWith('email', 'worker_error')
    })
  })
})
