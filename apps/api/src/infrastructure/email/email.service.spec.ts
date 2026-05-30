import { Test, TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { EmailService } from './email.service'
import type { EmailProvider, SendEmailJobData, WelcomeEmailData } from './email.types'
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
        {
          provide: PinoLogger,
          useValue: mockLogger,
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
      } satisfies SendEmailJobData

      await service.queue(jobData)

      // EQS-11: options come from the derived EMAIL_JOB_OPTIONS — the email 2s
      // first-retry backoff is preserved, while attempts + removeOnComplete /
      // removeOnFail are inherited from the single-source DEFAULT_JOB_OPTIONS
      // (proving it is the derived constant, not a bespoke literal).
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
          removeOnComplete: expect.objectContaining({ age: 3600 }),
          removeOnFail: expect.objectContaining({ age: 86400 }),
        })
      )
    })

    it('rejects a non-queueable (secret-bearing) template at runtime (EQS-02)', async () => {
      // A caller bypassing TypeScript must still be refused — secret templates
      // must never be persisted in BullMQ/Redis/Bull Board.
      const jobData = {
        template: EmailTemplate.PASSWORD_RESET,
        to: 'test@example.com',
        data: { name: 'X', resetUrl: 'https://x/reset?token=abc', expiresIn: '1m' },
      } as unknown as SendEmailJobData

      await expect(service.queue(jobData)).rejects.toThrow(/non-queueable/)
      expect(queueService.add).not.toHaveBeenCalled()
    })
  })

  describe('sendNow (direct, never enqueues — EQS-02)', () => {
    it('renders and sends via the provider without touching the queue', async () => {
      emailProvider.send.mockResolvedValue({ id: 'e_1', success: true })

      await service.sendNow(EmailTemplate.PASSWORD_RESET, 'to@example.com', {
        name: 'X',
        resetUrl: 'https://x/reset?token=abc',
        expiresIn: '1m',
      })

      expect(emailProvider.send).toHaveBeenCalledTimes(1)
      // EQS-08: sendNow forwards the plaintext alternative alongside html.
      expect(emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'to@example.com',
          html: expect.any(String),
          text: expect.any(String),
        })
      )
      expect(queueService.add).not.toHaveBeenCalled()
    })

    it('throws when the provider reports failure', async () => {
      emailProvider.send.mockResolvedValue({ id: '', success: false, error: 'boom' })

      await expect(
        service.sendNow(EmailTemplate.EMAIL_VERIFICATION, 'to@example.com', {
          name: 'X',
          verificationUrl: 'https://x/verify?token=xyz',
          expiresIn: '24h',
        })
      ).rejects.toThrow('boom')
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
    it('sends directly and never enqueues the reset token (EQS-02)', async () => {
      const data = {
        name: 'John Doe',
        resetUrl: 'https://example.com/reset?token=abc',
        expiresIn: '1 час',
      }

      emailProvider.send.mockResolvedValue({ id: 'e_1', success: true })

      await service.sendPasswordResetEmail('john@example.com', data)

      expect(emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'john@example.com' })
      )
      expect(queueService.add).not.toHaveBeenCalled()
    })
  })

  describe('sendEmailVerificationEmail', () => {
    it('sends directly and never enqueues the verification token (EQS-02)', async () => {
      const data = {
        name: 'John Doe',
        verificationUrl: 'https://example.com/verify?token=xyz',
        expiresIn: '24 часа',
      }

      emailProvider.send.mockResolvedValue({ id: 'e_1', success: true })

      await service.sendEmailVerificationEmail('john@example.com', data)

      expect(emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'john@example.com' })
      )
      expect(queueService.add).not.toHaveBeenCalled()
    })
  })

  describe('renderTemplate', () => {
    it('should render welcome template', async () => {
      const data: WelcomeEmailData = {
        name: 'John Doe',
        email: 'john@example.com',
      }

      const result = await service.renderTemplate(EmailTemplate.WELCOME, data)

      // Unit test: check that HTML, plaintext, and subject are returned.
      // Real plaintext content is validated in integration tests (Vitest).
      expect(result.html).toBeTruthy()
      expect(typeof result.html).toBe('string')
      expect(typeof result.text).toBe('string') // EQS-08: plaintext alternative
      expect(result.text).toBeTruthy()
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

    it('should render org invite template', async () => {
      const data = {
        orgName: 'Acme Inc.',
        inviterName: 'Alex',
        inviterEmail: 'alex@example.com',
        roleName: 'MEMBER',
        hasAccount: true,
        acceptUrl: 'https://example.com/invite/accept?token=abc',
        expiresIn: '7 days',
      }

      const result = await service.renderTemplate(EmailTemplate.ORG_INVITE, data)

      expect(result.html).toBeTruthy()
      expect(typeof result.html).toBe('string')
      expect(result.subject).toBe('orgInvite.subject')
    })

    it('should throw error for unknown template', async () => {
      await expect(service.renderTemplate('unknown' as any, {} as any)).rejects.toThrow(
        'Unknown template'
      )
    })
  })

  describe('sendOrgInviteEmail', () => {
    it('sends directly and never enqueues the accept token (EQS-02)', async () => {
      const data = {
        orgName: 'Acme Inc.',
        inviterName: 'Alex',
        inviterEmail: 'alex@example.com',
        roleName: 'MEMBER',
        hasAccount: false,
        acceptUrl: 'https://example.com/invite/accept?token=abc',
        expiresIn: '7 days',
      }

      emailProvider.send.mockResolvedValue({ id: 'e_1', success: true })

      await service.sendOrgInviteEmail('invitee@example.com', data)

      expect(emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'invitee@example.com' })
      )
      expect(queueService.add).not.toHaveBeenCalled()
    })
  })
})
