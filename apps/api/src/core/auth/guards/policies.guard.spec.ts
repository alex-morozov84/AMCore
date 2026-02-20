import { createPrismaAbility } from '@casl/prisma'
import { type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test, TestingModule } from '@nestjs/testing'

import { Action, Subject } from '@amcore/shared'

import { PoliciesGuard } from './policies.guard'

describe('PoliciesGuard', () => {
  let guard: PoliciesGuard
  let reflector: Reflector

  const mockAbility = createPrismaAbility([
    { action: Action.Read, subject: Subject.User },
    { action: Action.Create, subject: Subject.Organization },
  ])

  const createMockContext = (ability: any = mockAbility): ExecutionContext => {
    const mockRequest = {
      ability,
    }

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
      providers: [PoliciesGuard, Reflector],
    }).compile()

    guard = module.get<PoliciesGuard>(PoliciesGuard)
    reflector = module.get<Reflector>(Reflector)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should allow access when no policies are defined', async () => {
    jest.spyOn(reflector, 'get').mockReturnValueOnce(undefined)

    const context = createMockContext()
    const result = await guard.canActivate(context)

    expect(result).toBe(true)
  })

  it('should deny access when ability is not present on request', async () => {
    const policyHandler = jest.fn().mockReturnValue(true)
    jest.spyOn(reflector, 'get').mockReturnValueOnce([policyHandler])

    const context = createMockContext(null) // No ability (explicitly null)
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
    expect(policyHandler).not.toHaveBeenCalled()
  })

  it('should allow access when all function-based policy handlers return true', async () => {
    const handler1 = jest.fn().mockReturnValue(true)
    const handler2 = jest.fn().mockReturnValue(true)
    jest.spyOn(reflector, 'get').mockReturnValueOnce([handler1, handler2])

    const context = createMockContext()
    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(handler1).toHaveBeenCalledWith(mockAbility)
    expect(handler2).toHaveBeenCalledWith(mockAbility)
  })

  it('should deny access when any policy handler returns false', async () => {
    const handler1 = jest.fn().mockReturnValue(true)
    const handler2 = jest.fn().mockReturnValue(false) // Fails
    const handler3 = jest.fn().mockReturnValue(true)
    jest.spyOn(reflector, 'get').mockReturnValueOnce([handler1, handler2, handler3])

    const context = createMockContext()
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
    expect(handler1).toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
  })

  it('should execute class-based policy handlers', async () => {
    const classHandler = {
      handle: jest.fn().mockReturnValue(true),
    }
    jest.spyOn(reflector, 'get').mockReturnValueOnce([classHandler])

    const context = createMockContext()
    const result = await guard.canActivate(context)

    expect(result).toBe(true)
    expect(classHandler.handle).toHaveBeenCalledWith(mockAbility)
  })

  it('should work with real CASL ability checks', async () => {
    const policyHandler = (ability: any) => ability.can(Action.Read, Subject.User)
    jest.spyOn(reflector, 'get').mockReturnValueOnce([policyHandler])

    const context = createMockContext()
    const result = await guard.canActivate(context)

    expect(result).toBe(true)
  })

  it('should deny when CASL ability check fails', async () => {
    const policyHandler = (ability: any) => ability.can(Action.Delete, Subject.User)
    jest.spyOn(reflector, 'get').mockReturnValueOnce([policyHandler])

    const context = createMockContext()
    const result = await guard.canActivate(context)

    expect(result).toBe(false)
  })
})
