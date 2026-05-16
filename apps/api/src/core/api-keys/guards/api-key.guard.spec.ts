import type { ExecutionContext } from '@nestjs/common'

import { createMockContext, type MockContext, mockContextToPrisma } from '../../auth/test-context'
import { ApiKeyAbuseLimiterService } from '../api-key-abuse-limiter.service'
import { ApiKeysService } from '../api-keys.service'

import { ApiKeyGuard } from './api-key.guard'

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard
  let apiKeysService: jest.Mocked<Pick<ApiKeysService, 'verifyByShortToken' | 'touchLastUsed'>>
  let abuseLimiter: jest.Mocked<Pick<ApiKeyAbuseLimiterService, 'check' | 'consume' | 'reset'>>
  let mockCtx: MockContext

  const mockApiKey = {
    id: 'key-1',
    userId: 'user-1',
    organizationId: 'org-1',
    scopes: ['read:User'],
    user: { systemRole: 'USER' },
  }

  const SHORT_TOKEN = 'abc12345xyz'
  const FINGERPRINT = ApiKeyAbuseLimiterService.fingerprint(SHORT_TOKEN)

  const createMockExecutionContext = (authHeader?: string, ip = '1.2.3.4'): ExecutionContext => {
    const mockRequest = {
      headers: authHeader ? { authorization: authHeader } : {},
      ip,
      socket: { remoteAddress: ip },
      user: undefined as unknown,
    }

    return {
      switchToHttp: () => ({ getRequest: () => mockRequest }),
    } as unknown as ExecutionContext
  }

  function mockMembership(opts: { found: boolean; aclVersion?: number }) {
    mockCtx.prisma.orgMember.findUnique.mockResolvedValue(
      opts.found
        ? ({
            id: 'member-1',
            organization: { aclVersion: opts.aclVersion ?? 7 },
          } as never)
        : null
    )
  }

  beforeEach(() => {
    apiKeysService = {
      verifyByShortToken: jest.fn(),
      touchLastUsed: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Pick<ApiKeysService, 'verifyByShortToken' | 'touchLastUsed'>>

    abuseLimiter = {
      check: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Pick<ApiKeyAbuseLimiterService, 'check' | 'consume' | 'reset'>>

    mockCtx = createMockContext()

    guard = new ApiKeyGuard(
      apiKeysService as unknown as ApiKeysService,
      mockContextToPrisma(mockCtx),
      abuseLimiter as unknown as ApiKeyAbuseLimiterService
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('allows request with valid api key and builds principal with org context', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
    mockMembership({ found: true, aclVersion: 7 })

    const context = createMockExecutionContext(
      `Bearer amcore_live_${SHORT_TOKEN}_12345678901234567890123456789012`
    )
    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(apiKeysService.verifyByShortToken).toHaveBeenCalledWith(
      SHORT_TOKEN,
      '12345678901234567890123456789012'
    )

    const request = context.switchToHttp().getRequest()
    // Per ADR-033: API-key principal always carries organizationId + aclVersion.
    expect(request.user).toEqual({
      type: 'api_key',
      sub: 'user-1',
      systemRole: 'USER',
      organizationId: 'org-1',
      aclVersion: 7,
      scopes: ['read:User'],
    })
  })

  it('looks up membership by composite (userId, organizationId) key with org aclVersion include', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
    mockMembership({ found: true })

    const context = createMockExecutionContext(
      `Bearer amcore_live_${SHORT_TOKEN}_12345678901234567890123456789012`
    )
    await guard.canActivate(context)

    expect(mockCtx.prisma.orgMember.findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: 'user-1', organizationId: 'org-1' } },
      include: { organization: { select: { aclVersion: true } } },
    })
  })

  it('allows api keys whose long token contains underscores', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
    mockMembership({ found: true })

    const context = createMockExecutionContext(
      'Bearer amcore_live_abc_1234567_long_token_with_under_scores____'
    )
    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(apiKeysService.verifyByShortToken).toHaveBeenCalledWith(
      'abc_1234567',
      'long_token_with_under_scores____'
    )
  })

  it('denies when no authorization header', async () => {
    const context = createMockExecutionContext()
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
    expect(apiKeysService.verifyByShortToken).not.toHaveBeenCalled()
  })

  it('denies when header does not start with Bearer amcore_', async () => {
    const context = createMockExecutionContext('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })

  it('denies when key does not match expected format', async () => {
    const context = createMockExecutionContext('Bearer amcore_live_onlythreeparts')
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })

  // AK-08: only `amcore_live_` is accepted. The historical `amcore_test_`
  // spelling never carried real semantics (lookup is by shortToken alone,
  // so test_ would have authenticated any live key). Now treated like any
  // other malformed prefix — pre-parse failure, no limiter contact.
  it('denies amcore_test_ prefix (AK-08; pre-parse failure, no limiter)', async () => {
    const context = createMockExecutionContext(
      `Bearer amcore_test_${SHORT_TOKEN}_12345678901234567890123456789012`
    )
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
    expect(apiKeysService.verifyByShortToken).not.toHaveBeenCalled()
    expect(abuseLimiter.check).not.toHaveBeenCalled()
    expect(abuseLimiter.consume).not.toHaveBeenCalled()
  })

  it('denies when verification fails', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(null)

    const context = createMockExecutionContext(
      `Bearer amcore_live_${SHORT_TOKEN}_12345678901234567890123456789012`
    )
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })

  // AK-04 / ADR-033: membership is re-verified on every request.
  it('denies when owner is no longer a member of the bound organization', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
    mockMembership({ found: false })

    const context = createMockExecutionContext(
      `Bearer amcore_live_${SHORT_TOKEN}_12345678901234567890123456789012`
    )
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
    expect(apiKeysService.touchLastUsed).not.toHaveBeenCalled()
  })

  // Deleted organization: even if a stray ApiKey row survived FK cascade,
  // the membership lookup returns null and the credential is rejected.
  it('denies when the bound organization has been deleted', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
    mockCtx.prisma.orgMember.findUnique.mockResolvedValue(null)

    const context = createMockExecutionContext(
      `Bearer amcore_live_${SHORT_TOKEN}_12345678901234567890123456789012`
    )
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })

  // AK-07: brute-force protection on failed verifies.
  describe('AK-07: abuse limiter integration', () => {
    const VALID_HEADER = `Bearer amcore_live_${SHORT_TOKEN}_12345678901234567890123456789012`

    it('does not call the limiter for pre-parse failures (missing header)', async () => {
      const context = createMockExecutionContext()
      await guard.canActivate(context)

      expect(abuseLimiter.check).not.toHaveBeenCalled()
      expect(abuseLimiter.consume).not.toHaveBeenCalled()
      expect(abuseLimiter.reset).not.toHaveBeenCalled()
    })

    it('does not call the limiter for non-amcore Bearer headers', async () => {
      const context = createMockExecutionContext('Bearer eyJ.jwt.token')
      await guard.canActivate(context)

      expect(abuseLimiter.check).not.toHaveBeenCalled()
      expect(abuseLimiter.consume).not.toHaveBeenCalled()
    })

    it('does not call the limiter for malformed amcore_ headers', async () => {
      const context = createMockExecutionContext('Bearer amcore_live_brokenformat')
      await guard.canActivate(context)

      expect(abuseLimiter.check).not.toHaveBeenCalled()
      expect(abuseLimiter.consume).not.toHaveBeenCalled()
    })

    it('check() is called with (ip, fingerprint) before any DB work', async () => {
      apiKeysService.verifyByShortToken.mockResolvedValue(null)

      await guard.canActivate(createMockExecutionContext(VALID_HEADER, '5.6.7.8'))

      expect(abuseLimiter.check).toHaveBeenCalledWith('5.6.7.8', FINGERPRINT)
      // check is awaited before verify
      const checkCallIdx = abuseLimiter.check.mock.invocationCallOrder[0]!
      const verifyCallIdx = apiKeysService.verifyByShortToken.mock.invocationCallOrder[0]!
      expect(checkCallIdx).toBeLessThan(verifyCallIdx)
    })

    it('consume() is called when verifyByShortToken returns null', async () => {
      apiKeysService.verifyByShortToken.mockResolvedValue(null)

      const result = await guard.canActivate(createMockExecutionContext(VALID_HEADER, '5.6.7.8'))

      expect(result).toBe(false)
      expect(abuseLimiter.consume).toHaveBeenCalledWith('5.6.7.8', FINGERPRINT)
      expect(abuseLimiter.reset).not.toHaveBeenCalled()
    })

    it('consume() is called when membership lookup returns null', async () => {
      apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
      mockMembership({ found: false })

      const result = await guard.canActivate(createMockExecutionContext(VALID_HEADER, '5.6.7.8'))

      expect(result).toBe(false)
      expect(abuseLimiter.consume).toHaveBeenCalledWith('5.6.7.8', FINGERPRINT)
      expect(abuseLimiter.reset).not.toHaveBeenCalled()
    })

    it('reset() is called with fingerprint only (no IP) on success', async () => {
      apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
      mockMembership({ found: true })

      const result = await guard.canActivate(createMockExecutionContext(VALID_HEADER, '5.6.7.8'))

      expect(result).toBe(true)
      expect(abuseLimiter.reset).toHaveBeenCalledWith(FINGERPRINT)
      expect(abuseLimiter.reset).toHaveBeenCalledTimes(1)
      expect(abuseLimiter.consume).not.toHaveBeenCalled()
    })

    it('propagates 429 from check() — no DB work happens', async () => {
      abuseLimiter.check.mockRejectedValueOnce(new Error('Too many failed attempts'))

      await expect(guard.canActivate(createMockExecutionContext(VALID_HEADER))).rejects.toThrow(
        /Too many failed attempts/
      )

      expect(apiKeysService.verifyByShortToken).not.toHaveBeenCalled()
      expect(mockCtx.prisma.orgMember.findUnique).not.toHaveBeenCalled()
    })

    it('falls back to socket.remoteAddress when req.ip is undefined', async () => {
      apiKeysService.verifyByShortToken.mockResolvedValue(null)

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: VALID_HEADER },
            ip: undefined,
            socket: { remoteAddress: '9.9.9.9' },
            user: undefined,
          }),
        }),
      } as unknown as ExecutionContext

      await guard.canActivate(ctx)

      expect(abuseLimiter.check).toHaveBeenCalledWith('9.9.9.9', FINGERPRINT)
    })

    it("uses 'unknown' when both req.ip and socket.remoteAddress are missing", async () => {
      apiKeysService.verifyByShortToken.mockResolvedValue(null)

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: VALID_HEADER },
            ip: undefined,
            socket: {},
            user: undefined,
          }),
        }),
      } as unknown as ExecutionContext

      await guard.canActivate(ctx)

      expect(abuseLimiter.check).toHaveBeenCalledWith('unknown', FINGERPRINT)
    })
  })
})
