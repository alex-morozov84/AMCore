import type { ExecutionContext } from '@nestjs/common'

import { ApiKeysService } from '../api-keys.service'

import { ApiKeyGuard } from './api-key.guard'

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard
  let apiKeysService: jest.Mocked<Pick<ApiKeysService, 'verifyByShortToken' | 'touchLastUsed'>>

  const mockApiKey = {
    id: 'key-1',
    userId: 'user-1',
    scopes: ['workout:read'],
    user: { systemRole: 'USER' },
  }

  const createMockContext = (authHeader?: string): ExecutionContext => {
    const mockRequest = {
      headers: authHeader ? { authorization: authHeader } : {},
      user: undefined as unknown,
    }

    return {
      switchToHttp: () => ({ getRequest: () => mockRequest }),
    } as unknown as ExecutionContext
  }

  beforeEach(() => {
    apiKeysService = {
      verifyByShortToken: jest.fn(),
      touchLastUsed: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Pick<ApiKeysService, 'verifyByShortToken' | 'touchLastUsed'>>

    guard = new ApiKeyGuard(apiKeysService as unknown as ApiKeysService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should allow request with valid api key and populate request.user', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(mockApiKey as never)

    const context = createMockContext('Bearer amcore_live_abc12345_longTokenXYZ')
    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(apiKeysService.verifyByShortToken).toHaveBeenCalledWith('abc12345', 'longTokenXYZ')

    const request = context.switchToHttp().getRequest()
    expect(request.user).toEqual({
      type: 'api_key',
      sub: 'user-1',
      systemRole: 'USER',
      scopes: ['workout:read'],
    })
  })

  it('should deny when no authorization header', async () => {
    const context = createMockContext()
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
    expect(apiKeysService.verifyByShortToken).not.toHaveBeenCalled()
  })

  it('should deny when header does not start with Bearer amcore_', async () => {
    const context = createMockContext('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })

  it('should deny when key has wrong number of parts', async () => {
    const context = createMockContext('Bearer amcore_live_onlythreeparts')
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })

  it('should deny when verification fails', async () => {
    apiKeysService.verifyByShortToken.mockResolvedValue(null)

    const context = createMockContext('Bearer amcore_live_abc12345_badLongToken')
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })
})
