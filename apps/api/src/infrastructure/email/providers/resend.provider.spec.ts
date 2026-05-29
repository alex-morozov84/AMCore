import { Test, TestingModule } from '@nestjs/testing'
import type { PinoLogger } from 'nestjs-pino'
import { Resend } from 'resend'

import { ResendEmailProvider } from './resend.provider'

import { EnvService } from '@/env/env.service'

// Mock Resend SDK
jest.mock('resend')

describe('ResendEmailProvider', () => {
  let provider: ResendEmailProvider
  let envService: jest.Mocked<EnvService>
  let mockResendInstance: any
  let mockSend: jest.Mock
  let mockLogger: jest.Mocked<PinoLogger>

  beforeEach(async () => {
    // Create mock send function
    mockSend = jest.fn()

    // Create mock Resend instance
    mockResendInstance = {
      emails: {
        send: mockSend,
      },
    }

    // Mock Resend constructor
    ;(Resend as jest.MockedClass<typeof Resend>).mockImplementation(() => mockResendInstance)

    // Mock EnvService
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: EnvService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'RESEND_API_KEY') return 're_test_key_123'
              if (key === 'EMAIL_FROM') return 'noreply@amcore.com'
              return null
            }),
          },
        },
      ],
    }).compile()

    envService = module.get(EnvService)
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    provider = new ResendEmailProvider(envService, mockLogger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should be defined', () => {
    expect(provider).toBeDefined()
  })

  it('should throw error if RESEND_API_KEY is missing', () => {
    envService.get.mockReturnValue(undefined as any)

    expect(() => new ResendEmailProvider(envService, mockLogger)).toThrow(
      'RESEND_API_KEY is required for Resend provider'
    )
  })

  describe('send', () => {
    it('should send email successfully', async () => {
      const mockEmailId = 'email_abc123'

      mockSend.mockResolvedValue({
        data: { id: mockEmailId },
        error: null,
      } as any)

      const result = await provider.send({
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test</p>',
      })

      expect(result).toEqual({
        id: mockEmailId,
        success: true,
      })

      expect(mockSend).toHaveBeenCalledWith(
        {
          from: 'noreply@amcore.com',
          to: ['test@example.com'],
          subject: 'Test Subject',
          html: '<p>Test</p>',
          text: undefined,
          replyTo: undefined,
        },
        undefined // no idempotency key on this call
      )
    })

    it('should use custom from address', async () => {
      mockSend.mockResolvedValue({
        data: { id: 'email_123' },
        error: null,
      } as any)

      await provider.send({
        to: 'test@example.com',
        from: 'custom@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@example.com',
        }),
        undefined
      )
    })

    it('classifies a deterministic Resend error as non-retryable (EQS-03)', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'Invalid API key', name: 'invalid_api_key' },
      } as any)

      const result = await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })

      expect(result).toEqual({
        id: '',
        success: false,
        error: 'Invalid API key',
        retryable: false,
      })
      // Per-attempt failures log at warn, not error — the processor owns the
      // terminal error-level dead-letter signal (EQS-03).
      expect(mockLogger.warn).toHaveBeenCalled()
      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('classifies a transient Resend error as retryable (EQS-03)', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'Too many requests', name: 'rate_limit_exceeded' },
      } as any)

      const result = await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })

      expect(result).toMatchObject({ success: false, retryable: true })
    })

    it('classifies an unknown Resend error code as retryable (safe default — EQS-03)', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'Weird', name: 'some_future_code' },
      } as any)

      const result = await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })

      expect(result).toMatchObject({ success: false, retryable: true })
    })

    it('treats a thrown exception (network) as retryable (EQS-03)', async () => {
      mockSend.mockRejectedValue(new Error('Network error'))

      const result = await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })

      expect(result).toEqual({
        id: '',
        success: false,
        error: 'Network error',
        retryable: true,
      })
      expect(mockLogger.warn).toHaveBeenCalled()
      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('forwards the idempotency key to Resend (EQS-03)', async () => {
      mockSend.mockResolvedValue({ data: { id: 'email_1' }, error: null } as any)

      await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        idempotencyKey: 'email:job-42',
      })

      expect(mockSend).toHaveBeenCalledWith(expect.any(Object), {
        idempotencyKey: 'email:job-42',
      })
    })

    it('should include text and replyTo when provided', async () => {
      mockSend.mockResolvedValue({
        data: { id: 'email_123' },
        error: null,
      } as any)

      await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        text: 'Plain text',
        replyTo: 'reply@example.com',
      })

      expect(mockSend).toHaveBeenCalledWith(
        {
          from: 'noreply@amcore.com',
          to: ['test@example.com'],
          subject: 'Test',
          html: '<p>Test</p>',
          text: 'Plain text',
          replyTo: 'reply@example.com',
        },
        undefined
      )
    })
  })
})
