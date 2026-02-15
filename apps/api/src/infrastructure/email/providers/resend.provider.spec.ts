import { Test, TestingModule } from '@nestjs/testing'
import { Resend } from 'resend'

import { ResendEmailProvider } from './resend.provider'

import { EnvService } from '@/env/env.service'

// Mock Resend SDK
jest.mock('resend')

describe('ResendEmailProvider', () => {
  let provider: ResendEmailProvider
  let envService: jest.Mocked<EnvService>
  let mockResendInstance: jest.Mocked<Resend>

  beforeEach(async () => {
    // Create mock Resend instance
    mockResendInstance = {
      emails: {
        send: jest.fn(),
      },
    } as any

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
    provider = new ResendEmailProvider(envService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should be defined', () => {
    expect(provider).toBeDefined()
  })

  it('should throw error if RESEND_API_KEY is missing', () => {
    envService.get.mockReturnValue(undefined as any)

    expect(() => new ResendEmailProvider(envService)).toThrow(
      'RESEND_API_KEY is required for Resend provider'
    )
  })

  describe('send', () => {
    it('should send email successfully', async () => {
      const mockEmailId = 'email_abc123'

      mockResendInstance.emails.send.mockResolvedValue({
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

      expect(mockResendInstance.emails.send).toHaveBeenCalledWith({
        from: 'noreply@amcore.com',
        to: ['test@example.com'],
        subject: 'Test Subject',
        html: '<p>Test</p>',
        text: undefined,
        replyTo: undefined,
      })
    })

    it('should use custom from address', async () => {
      mockResendInstance.emails.send.mockResolvedValue({
        data: { id: 'email_123' },
        error: null,
      } as any)

      await provider.send({
        to: 'test@example.com',
        from: 'custom@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })

      expect(mockResendInstance.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@example.com',
        })
      )
    })

    it('should handle Resend API error', async () => {
      mockResendInstance.emails.send.mockResolvedValue({
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
      mockResendInstance.emails.send.mockRejectedValue(new Error('Network error'))

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
      mockResendInstance.emails.send.mockResolvedValue({
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

      expect(mockResendInstance.emails.send).toHaveBeenCalledWith({
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
