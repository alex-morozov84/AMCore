import { Test, TestingModule } from '@nestjs/testing'

import { EmailService } from './email.service'
import type { EmailProvider, WelcomeEmailData } from './email.types'
import { EmailTemplate } from './email.types'

import { EnvService } from '@/env/env.service'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'
import { QueueService } from '@/infrastructure/queue/queue.service'

// Mock @react-email/render
jest.mock('@react-email/render', () => ({
  render: jest.fn(async (component) => `<html>${JSON.stringify(component)}</html>`),
}))

// Mock @formatjs/intl (ESM module)
jest.mock('@formatjs/intl', () => ({
  createIntl: jest.fn(() => ({
    formatMessage: jest.fn((descriptor, values) => {
      // Simple mock that returns message ID with interpolated values
      if (values) {
        return Object.entries(values).reduce(
          (msg, [key, val]) => msg.replace(`{${key}}`, String(val)),
          descriptor.id
        )
      }
      return descriptor.id
    }),
  })),
}))

describe('EmailService', () => {
  let service: EmailService
  let emailProvider: jest.Mocked<EmailProvider>
  let queueService: jest.Mocked<QueueService>

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: 'EmailProvider',
          useValue: {
            send: jest.fn(),
          },
        },
        {
          provide: QueueService,
          useValue: {
            add: jest.fn(),
          },
        },
        {
          provide: EnvService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile()

    service = module.get<EmailService>(EmailService)
    emailProvider = module.get('EmailProvider')
    queueService = module.get(QueueService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('send', () => {
    it('should delegate to email provider', async () => {
      const params = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      }

      const mockResult = { id: 'email_123', success: true }
      emailProvider.send.mockResolvedValue(mockResult)

      const result = await service.send(params)

      expect(result).toEqual(mockResult)
      expect(emailProvider.send).toHaveBeenCalledWith(params)
    })
  })

  describe('queue', () => {
    it('should add job to email queue', async () => {
      const jobData = {
        template: EmailTemplate.WELCOME,
        to: 'test@example.com',
        data: { name: 'Test User', email: 'test@example.com' },
      }

      await service.queue(jobData)

      expect(queueService.add).toHaveBeenCalledWith(
        QueueName.EMAIL,
        JobName.SEND_EMAIL,
        jobData,
        expect.objectContaining({
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        })
      )
    })
  })

  describe('sendWelcomeEmail', () => {
    it('should queue welcome email', async () => {
      const data: WelcomeEmailData = {
        name: 'John Doe',
        email: 'john@example.com',
      }

      queueService.add.mockResolvedValue({} as any)

      await service.sendWelcomeEmail(data)

      expect(queueService.add).toHaveBeenCalledWith(
        QueueName.EMAIL,
        JobName.SEND_EMAIL,
        {
          template: EmailTemplate.WELCOME,
          to: 'john@example.com',
          data,
        },
        expect.any(Object)
      )
    })
  })

  describe('sendPasswordResetEmail', () => {
    it('should queue password reset email', async () => {
      const data = {
        name: 'John Doe',
        resetUrl: 'https://example.com/reset?token=abc',
        expiresIn: '1 час',
      }

      queueService.add.mockResolvedValue({} as any)

      await service.sendPasswordResetEmail('john@example.com', data)

      expect(queueService.add).toHaveBeenCalledWith(
        QueueName.EMAIL,
        JobName.SEND_EMAIL,
        {
          template: EmailTemplate.PASSWORD_RESET,
          to: 'john@example.com',
          data,
        },
        expect.any(Object)
      )
    })
  })

  describe('sendEmailVerificationEmail', () => {
    it('should queue email verification email', async () => {
      const data = {
        name: 'John Doe',
        verificationUrl: 'https://example.com/verify?token=xyz',
        expiresIn: '24 часа',
      }

      queueService.add.mockResolvedValue({} as any)

      await service.sendEmailVerificationEmail('john@example.com', data)

      expect(queueService.add).toHaveBeenCalledWith(
        QueueName.EMAIL,
        JobName.SEND_EMAIL,
        {
          template: EmailTemplate.EMAIL_VERIFICATION,
          to: 'john@example.com',
          data,
        },
        expect.any(Object)
      )
    })
  })

  describe('renderTemplate', () => {
    it('should render welcome template', async () => {
      const data: WelcomeEmailData = {
        name: 'John Doe',
        email: 'john@example.com',
      }

      const result = await service.renderTemplate(EmailTemplate.WELCOME, data)

      // Unit test: check that HTML and subject are returned
      // Content testing is done in integration tests (Vitest)
      expect(result.html).toBeTruthy()
      expect(typeof result.html).toBe('string')
      expect(result.subject).toBe('welcome.subject')
    })

    it('should render password reset template', async () => {
      const data = {
        name: 'John Doe',
        resetUrl: 'https://example.com/reset?token=abc',
        expiresIn: '1 час',
      }

      const result = await service.renderTemplate(EmailTemplate.PASSWORD_RESET, data)

      expect(result.html).toBeTruthy()
      expect(typeof result.html).toBe('string')
      expect(result.subject).toBe('passwordReset.subject')
    })

    it('should render email verification template', async () => {
      const data = {
        name: 'John Doe',
        verificationUrl: 'https://example.com/verify?token=xyz',
        expiresIn: '24 часа',
      }

      const result = await service.renderTemplate(EmailTemplate.EMAIL_VERIFICATION, data)

      expect(result.html).toBeTruthy()
      expect(typeof result.html).toBe('string')
      expect(result.subject).toBe('emailVerification.subject')
    })

    it('should throw error for unknown template', async () => {
      await expect(service.renderTemplate('unknown' as any, {} as any)).rejects.toThrow(
        'Unknown template'
      )
    })
  })
})
