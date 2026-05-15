import type { ExecutionContext } from '@nestjs/common'

import { createMockContext, type MockContext, mockContextToPrisma } from '../../auth/test-context'
import { ApiKeysService } from '../api-keys.service'

import { ApiKeyGuard } from './api-key.guard'

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard
  let apiKeysService: jest.Mocked<Pick<ApiKeysService, 'verifyByShortToken' | 'touchLastUsed'>>
  let mockCtx: MockContext

  const mockApiKey = {
    id: 'key-1',
    userId: 'user-1',
    organizationId: 'org-1',
    scopes: ['workout:read'],
    user: { systemRole: 'USER' },
  }

  const createMockExecutionContext = (authHeader?: string): ExecutionContext => {
    const mockRequest = {
      headers: authHeader ? { authorization: authHeader } : {},
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

    mockCtx = createMockContext()

    guard = new ApiKeyGuard(
      apiKeysService as unknown as ApiKeysService,
      mockContextToPrisma(mockCtx)
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('allows request with valid api key and builds principal with org context', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
    mockMembership({ found: true, aclVersion: 7 })

    const context = createMockExecutionContext(
      'Bearer amcore_live_abc12345xyz_12345678901234567890123456789012'
    )
    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(apiKeysService.verifyByShortToken).toHaveBeenCalledWith(
      'abc12345xyz',
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
      scopes: ['workout:read'],
    })
  })

  it('looks up membership by composite (userId, organizationId) key with org aclVersion include', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
    mockMembership({ found: true })

    const context = createMockExecutionContext(
      'Bearer amcore_live_abc12345xyz_12345678901234567890123456789012'
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

  it('denies when verification fails', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(null)

    const context = createMockExecutionContext(
      'Bearer amcore_live_abc12345xyz_12345678901234567890123456789012'
    )
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })

  // AK-04 / ADR-033: membership is re-verified on every request.
  it('denies when owner is no longer a member of the bound organization', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)
    mockMembership({ found: false })

    const context = createMockExecutionContext(
      'Bearer amcore_live_abc12345xyz_12345678901234567890123456789012'
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
      'Bearer amcore_live_abc12345xyz_12345678901234567890123456789012'
    )
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })
})
