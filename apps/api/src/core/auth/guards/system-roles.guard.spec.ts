import { type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test, TestingModule } from '@nestjs/testing'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { SystemRolesGuard } from './system-roles.guard'

describe('SystemRolesGuard', () => {
  let guard: SystemRolesGuard
  let reflector: Reflector

  const createMockContext = (user?: RequestPrincipal): ExecutionContext => {
    const mockRequest = { user }

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemRolesGuard, Reflector],
    }).compile()

    guard = module.get<SystemRolesGuard>(SystemRolesGuard)
    reflector = module.get<Reflector>(Reflector)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should allow access when no roles are required', () => {
    jest.spyOn(reflector, 'get').mockReturnValueOnce(undefined)

    const user: RequestPrincipal = {
      type: 'jwt',
      sub: 'user-1',
      systemRole: SystemRole.User,
    }

    const context = createMockContext(user)
    const result = guard.canActivate(context)

    expect(result).toBe(true)
  })

  it('should allow access when user has required system role', () => {
    jest.spyOn(reflector, 'get').mockReturnValueOnce([SystemRole.SuperAdmin])

    const user: RequestPrincipal = {
      type: 'jwt',
      sub: 'admin-1',
      systemRole: SystemRole.SuperAdmin,
    }

    const context = createMockContext(user)
    const result = guard.canActivate(context)

    expect(result).toBe(true)
  })

  it('should deny access when user does not have required system role', () => {
    jest.spyOn(reflector, 'get').mockReturnValueOnce([SystemRole.SuperAdmin])

    const user: RequestPrincipal = {
      type: 'jwt',
      sub: 'user-1',
      systemRole: SystemRole.User,
    }

    const context = createMockContext(user)
    const result = guard.canActivate(context)

    expect(result).toBe(false)
  })

  it('should deny access when user is not authenticated', () => {
    jest.spyOn(reflector, 'get').mockReturnValueOnce([SystemRole.User])

    const context = createMockContext(undefined)
    const result = guard.canActivate(context)

    expect(result).toBe(false)
  })

  it('should allow access when user has one of multiple required roles', () => {
    jest.spyOn(reflector, 'get').mockReturnValueOnce([SystemRole.SuperAdmin, SystemRole.User])

    const user: RequestPrincipal = {
      type: 'jwt',
      sub: 'user-1',
      systemRole: SystemRole.User,
    }

    const context = createMockContext(user)
    const result = guard.canActivate(context)

    expect(result).toBe(true)
  })
})
