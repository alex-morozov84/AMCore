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

      expect(mockSend).toHaveBeenCalledWith({
        from: 'noreply@amcore.com',
        to: ['test@example.com'],
        subject: 'Test Subject',
        html: '<p>Test</p>',
        text: undefined,
        replyTo: undefined,
      })
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
        })
      )
    })

    it('should handle Resend API error', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'Invalid API key' },
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
      })
    })

    it('should handle exception during send', async () => {
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

      expect(mockSend).toHaveBeenCalledWith({
        from: 'noreply@amcore.com',
        to: ['test@example.com'],
        subject: 'Test',
        html: '<p>Test</p>',
        text: 'Plain text',
        replyTo: 'reply@example.com',
      })
    })
  })
})
