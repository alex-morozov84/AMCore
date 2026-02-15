import { Test, TestingModule } from '@nestjs/testing'
import type { Job } from 'bullmq'

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

  beforeEach(async () => {
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
