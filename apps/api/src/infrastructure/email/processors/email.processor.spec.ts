import { Test, TestingModule } from '@nestjs/testing'
import type { Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'

import { EmailService } from '../email.service'
import type { SendEmailJobData } from '../email.types'
import { EmailTemplate } from '../email.types'

import { EmailProcessor } from './email.processor'

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

  beforeEach(async () => {
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>

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
        subject: 'Welcome',
      })

      emailService.send.mockResolvedValue({
        id: 'email_abc123',
        success: true,
      })

      await processor.process(job)

      expect(emailService.renderTemplate).toHaveBeenCalledWith(EmailTemplate.WELCOME, jobData.data)

      expect(emailService.send).toHaveBeenCalledWith({
        to: 'test@example.com',
        subject: 'Welcome',
        html: '<p>Welcome!</p>',
      })
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
    })

    it('discards a non-queueable (secret-bearing) job without rendering, sending, or throwing (EQS-02)', async () => {
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
        expect.stringContaining('non-queueable')
      )
    })

    it('should throw error if email sending fails', async () => {
      const jobData: SendEmailJobData = {
        template: EmailTemplate.WELCOME,
        to: 'test@example.com',
        data: { name: 'Test User', email: 'test@example.com' },
      }

      const job = {
        id: 'job-789',
        name: JobName.SEND_EMAIL,
        data: jobData,
        attemptsMade: 0,
      } as Job<SendEmailJobData>

      emailService.renderTemplate.mockResolvedValue({
        html: '<p>Welcome!</p>',
        subject: 'Welcome',
      })

      emailService.send.mockResolvedValue({
        id: '',
        success: false,
        error: 'SMTP error',
      })

      await expect(processor.process(job)).rejects.toThrow('SMTP error')
    })

    it('should throw error if rendering fails', async () => {
      const jobData: SendEmailJobData = {
        template: EmailTemplate.WELCOME,
        to: 'test@example.com',
        data: { name: 'Test User', email: 'test@example.com' },
      }

      const job = {
        id: 'job-101',
        name: JobName.SEND_EMAIL,
        data: jobData,
        attemptsMade: 1,
      } as Job<SendEmailJobData>

      emailService.renderTemplate.mockRejectedValue(new Error('Template error'))

      await expect(processor.process(job)).rejects.toThrow('Template error')
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
})
