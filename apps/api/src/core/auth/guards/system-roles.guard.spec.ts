import { type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test, TestingModule } from '@nestjs/testing'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../../common/exceptions'
import { PrivilegedRoleService } from '../privileged-role.service'

import { SystemRolesGuard } from './system-roles.guard'

describe('SystemRolesGuard', () => {
  let guard: SystemRolesGuard
  let reflector: Reflector
  let privilegedRole: jest.Mocked<Pick<PrivilegedRoleService, 'getCurrentSystemRole'>>

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
    privilegedRole = { getCurrentSystemRole: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemRolesGuard,
        Reflector,
        { provide: PrivilegedRoleService, useValue: privilegedRole },
      ],
    }).compile()

    guard = module.get<SystemRolesGuard>(SystemRolesGuard)
    reflector = module.get<Reflector>(Reflector)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('allows access when no roles are required — no DB read', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined)

    const user: RequestPrincipal = { type: 'jwt', sub: 'user-1', systemRole: SystemRole.User }

    await expect(guard.canActivate(createMockContext(user))).resolves.toBe(true)
    expect(privilegedRole.getCurrentSystemRole).not.toHaveBeenCalled()
  })

  it('denies when user is not authenticated', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([SystemRole.SuperAdmin])

    await expect(guard.canActivate(createMockContext(undefined))).rejects.toThrow(
      ForbiddenException
    )
    expect(privilegedRole.getCurrentSystemRole).not.toHaveBeenCalled()
  })

  it('denies when the claim does not satisfy the requirement — no DB read (T4)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([SystemRole.SuperAdmin])

    // A just-promoted user's old token still carries the USER claim: rejected
    // at the claim gate before any DB read.
    const user: RequestPrincipal = { type: 'jwt', sub: 'user-1', systemRole: SystemRole.User }

    await expect(guard.canActivate(createMockContext(user))).rejects.toThrow(ForbiddenException)
    expect(privilegedRole.getCurrentSystemRole).not.toHaveBeenCalled()
  })

  it('allows when claim AND current DB role both satisfy the requirement', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([SystemRole.SuperAdmin])
    privilegedRole.getCurrentSystemRole.mockResolvedValue(SystemRole.SuperAdmin)

    const user: RequestPrincipal = {
      type: 'jwt',
      sub: 'admin-1',
      systemRole: SystemRole.SuperAdmin,
    }

    await expect(guard.canActivate(createMockContext(user))).resolves.toBe(true)
    expect(privilegedRole.getCurrentSystemRole).toHaveBeenCalledWith('admin-1')
  })

  it('denies when the claim is SUPER_ADMIN but the current DB role was demoted (T1)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([SystemRole.SuperAdmin])
    // Stale SUPER_ADMIN claim, current DB role is now USER → fail closed.
    privilegedRole.getCurrentSystemRole.mockResolvedValue(SystemRole.User)

    const user: RequestPrincipal = {
      type: 'jwt',
      sub: 'admin-1',
      systemRole: SystemRole.SuperAdmin,
    }

    await expect(guard.canActivate(createMockContext(user))).rejects.toThrow(ForbiddenException)
  })

  it('denies when the current DB role is null (user deleted) — fail closed', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([SystemRole.SuperAdmin])
    privilegedRole.getCurrentSystemRole.mockResolvedValue(null)

    const user: RequestPrincipal = { type: 'jwt', sub: 'gone-1', systemRole: SystemRole.SuperAdmin }

    await expect(guard.canActivate(createMockContext(user))).rejects.toThrow(ForbiddenException)
  })

  it('propagates a DB lookup failure instead of masking it as 403 (fail-closed, observable)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([SystemRole.SuperAdmin])
    const infraError = new Error('pool timeout')
    privilegedRole.getCurrentSystemRole.mockRejectedValue(infraError)

    const user: RequestPrincipal = {
      type: 'jwt',
      sub: 'admin-1',
      systemRole: SystemRole.SuperAdmin,
    }

    await expect(guard.canActivate(createMockContext(user))).rejects.toBe(infraError)
  })
})
