jest.mock('./providers/oauth-provider.factory', () => ({ OAuthProviderFactory: jest.fn() }))
jest.mock('./oauth-client.service', () => ({ OAuthClientService: jest.fn() }))

import { HttpStatus } from '@nestjs/common'
import type { OAuthProvider, User } from '@prisma/client'

import { AuthErrorCode } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'

import { OAuthService } from './oauth.service'
import type { OAuthStateData } from './oauth-state.service'

const mockUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'user@example.com',
    emailVerified: true,
    passwordHash: null,
    name: 'Test User',
    avatarUrl: null,
    phone: null,
    locale: 'ru',
    timezone: 'Europe/Moscow',
    systemRole: 'USER' as never,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastLoginAt: null,
    ...overrides,
  }) as User

const mockProfile = {
  providerId: 'google-123',
  provider: 'google',
  email: 'user@example.com',
  emailVerified: true,
  displayName: 'Test User',
  avatarUrl: null,
  phone: null,
}

describe('OAuthService', () => {
  let service: OAuthService
  let prisma: jest.Mocked<any>
  let tokenService: jest.Mocked<any>
  let sessionService: jest.Mocked<any>
  let userCacheService: jest.Mocked<any>
  let providerFactory: jest.Mocked<any>
  let stateService: jest.Mocked<any>
  let mockProvider: jest.Mocked<any>

  const requestInfo = { userAgent: 'test-agent', ipAddress: '127.0.0.1' }

  beforeEach(() => {
    mockProvider = {
      getAuthorizationURL: jest
        .fn()
        .mockResolvedValue(new URL('https://accounts.google.com/o/oauth2/auth?state=x')),
      exchangeCode: jest.fn().mockResolvedValue({ accessToken: 'access-token' }),
      getUserProfile: jest.fn().mockResolvedValue(mockProfile),
    }

    prisma = {
      oAuthAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(mockUser()),
        create: jest.fn().mockResolvedValue(mockUser()),
        update: jest.fn().mockResolvedValue(mockUser()),
      },
      $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
    }

    tokenService = {
      generateAccessToken: jest.fn().mockReturnValue('jwt-access-token'),
    }

    sessionService = {
      createSession: jest.fn().mockResolvedValue('refresh-token-raw'),
    }

    userCacheService = {
      invalidateUser: jest.fn().mockResolvedValue(undefined),
    }

    providerFactory = {
      get: jest.fn().mockReturnValue(mockProvider),
      getAvailableProviders: jest.fn().mockReturnValue(['google', 'github', 'apple']),
    }

    stateService = {
      store: jest.fn().mockResolvedValue(undefined),
      consume: jest
        .fn()
        .mockResolvedValue({ provider: 'google', codeVerifier: 'verifier' } as OAuthStateData),
    }

    service = new OAuthService(
      prisma,
      tokenService,
      sessionService,
      userCacheService,
      providerFactory,
      stateService
    )
  })

  describe('getAuthorizationURL', () => {
    it('should store state in Redis and return provider URL', async () => {
      const result = await service.getAuthorizationURL('google')

      expect(providerFactory.get).toHaveBeenCalledWith('google')
      expect(stateService.store).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ provider: 'google', codeVerifier: expect.any(String) })
      )
      expect(result.url).toContain('accounts.google.com')
    })

    it('should throw when provider is not configured', async () => {
      providerFactory.get.mockImplementation(() => {
        throw new AppException(
          'not configured',
          HttpStatus.BAD_REQUEST,
          AuthErrorCode.OAUTH_PROVIDER_NOT_CONFIGURED
        )
      })

      await expect(service.getAuthorizationURL('vk')).rejects.toThrow(AppException)
    })
  })

  describe('handleCallback', () => {
    it('should return AuthResult with tokens on success', async () => {
      prisma.user.create.mockResolvedValue(mockUser())

      const result = await service.handleCallback('google', 'code', 'state', requestInfo)

      expect(result.accessToken).toBe('jwt-access-token')
      expect(result.refreshToken).toBe('refresh-token-raw')
      expect(result.user.email).toBe('user@example.com')
    })

    it('should throw OAUTH_STATE_INVALID when state is missing', async () => {
      stateService.consume.mockResolvedValue(null)

      await expect(
        service.handleCallback('google', 'code', 'bad-state', requestInfo)
      ).rejects.toMatchObject({
        errorCode: AuthErrorCode.OAUTH_STATE_INVALID,
      })
    })

    it('should throw OAUTH_STATE_INVALID when provider does not match', async () => {
      stateService.consume.mockResolvedValue({
        provider: 'github',
        codeVerifier: 'v',
      } as OAuthStateData)

      await expect(
        service.handleCallback('google', 'code', 'state', requestInfo)
      ).rejects.toMatchObject({
        errorCode: AuthErrorCode.OAUTH_STATE_INVALID,
      })
    })

    it('should throw OAUTH_EMAIL_REQUIRED when provider returns no email', async () => {
      mockProvider.getUserProfile.mockResolvedValue({ ...mockProfile, email: null })

      await expect(
        service.handleCallback('google', 'code', 'state', requestInfo)
      ).rejects.toMatchObject({
        errorCode: AuthErrorCode.OAUTH_EMAIL_REQUIRED,
      })
    })
  })

  describe('findOrCreateUser', () => {
    it('should return existing user when OAuth account is already linked', async () => {
      const user = mockUser()
      prisma.oAuthAccount.findUnique.mockResolvedValue({ userId: user.id, user })

      const result = await service.handleCallback('google', 'code', 'state', requestInfo)

      expect(prisma.user.create).not.toHaveBeenCalled()
      expect(result.user.id).toBe(user.id)
    })

    it('should link OAuth account to existing user with same email', async () => {
      const user = mockUser({ emailVerified: false })
      prisma.oAuthAccount.findUnique.mockResolvedValue(null)
      prisma.user.findUnique.mockResolvedValue(user)
      prisma.user.findUniqueOrThrow.mockResolvedValue(mockUser({ emailVerified: true }))

      await service.handleCallback('google', 'code', 'state', requestInfo)

      expect(prisma.$transaction).toHaveBeenCalled()
      expect(userCacheService.invalidateUser).toHaveBeenCalledWith(user.id)
    })

    it('should mark email as verified when provider confirms it', async () => {
      const unverifiedUser = mockUser({ emailVerified: false })
      prisma.oAuthAccount.findUnique.mockResolvedValue(null)
      prisma.user.findUnique.mockResolvedValue(unverifiedUser)
      prisma.user.findUniqueOrThrow.mockResolvedValue(mockUser({ emailVerified: true }))

      const result = await service.handleCallback('google', 'code', 'state', requestInfo)

      expect(prisma.$transaction).toHaveBeenCalled()
      expect(result.user.emailVerified).toBe(true)
    })

    it('should create new user when no match found', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null)
      prisma.user.findUnique.mockResolvedValue(null)

      await service.handleCallback('google', 'code', 'state', requestInfo)

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: mockProfile.email,
            emailVerified: true,
            accounts: expect.objectContaining({
              create: expect.objectContaining({ provider: 'GOOGLE' as OAuthProvider }),
            }),
          }),
        })
      )
    })

    it('should update lastLoginAt when returning existing OAuth user', async () => {
      const user = mockUser()
      prisma.oAuthAccount.findUnique.mockResolvedValue({ userId: user.id, user })

      await service.handleCallback('google', 'code', 'state', requestInfo)

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        })
      )
    })
  })
})
