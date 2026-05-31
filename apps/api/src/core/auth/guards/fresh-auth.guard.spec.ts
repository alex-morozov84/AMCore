import { type ExecutionContext, HttpStatus } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthErrorCode, type RequestPrincipal } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { EnvService } from '../../../env/env.service'
import { PrismaService } from '../../../prisma'

import { FreshAuthGuard } from './fresh-auth.guard'

describe('FreshAuthGuard', () => {
  let guard: FreshAuthGuard
  let reflector: { getAllAndOverride: jest.Mock }
  let findUnique: jest.Mock
  let env: { get: jest.Mock }

  const ctx = (user?: Partial<RequestPrincipal>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    }) as unknown as ExecutionContext

  const principal: RequestPrincipal = {
    type: 'jwt',
    sub: 'user-1',
    systemRole: 'SUPER_ADMIN',
    sid: 'session-1',
  }

  const freshSession = {
    lastAuthAt: new Date(),
    revokedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    userId: 'user-1',
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() }
    findUnique = jest.fn()
    env = { get: jest.fn().mockReturnValue(600) }
    guard = new FreshAuthGuard(
      reflector as unknown as Reflector,
      { session: { findUnique } } as unknown as PrismaService,
      env as unknown as EnvService
    )
  })

  const expectStepUp = async (context: ExecutionContext) => {
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: AuthErrorCode.STEP_UP_REQUIRED,
    })
  }

  it('allows (no DB read) when the route is not annotated', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined)

    await expect(guard.canActivate(ctx(principal))).resolves.toBe(true)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('fails closed when the token has no sid (legacy) — no DB read', async () => {
    reflector.getAllAndOverride.mockReturnValue(null)

    await expectStepUp(ctx({ ...principal, sid: undefined }))
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('throws 403 STEP_UP_REQUIRED with the right status', async () => {
    reflector.getAllAndOverride.mockReturnValue(null)

    const err: unknown = await guard
      .canActivate(ctx({ ...principal, sid: undefined }))
      .catch((e) => e)

    expect(err).toBeInstanceOf(AppException)
    expect((err as AppException).getStatus()).toBe(HttpStatus.FORBIDDEN)
    expect((err as AppException).errorCode).toBe(AuthErrorCode.STEP_UP_REQUIRED)
  })

  it('allows when the session is fresh (claim sid resolves a recent lastAuthAt)', async () => {
    reflector.getAllAndOverride.mockReturnValue(null)
    findUnique.mockResolvedValue(freshSession)

    await expect(guard.canActivate(ctx(principal))).resolves.toBe(true)
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      select: { lastAuthAt: true, revokedAt: true, expiresAt: true, userId: true },
    })
  })

  it('fails closed when the session is not found', async () => {
    reflector.getAllAndOverride.mockReturnValue(null)
    findUnique.mockResolvedValue(null)
    await expectStepUp(ctx(principal))
  })

  it('fails closed when the session is revoked (Stage 1 role change / logout)', async () => {
    reflector.getAllAndOverride.mockReturnValue(null)
    findUnique.mockResolvedValue({ ...freshSession, revokedAt: new Date() })
    await expectStepUp(ctx(principal))
  })

  it('fails closed when the session is expired', async () => {
    reflector.getAllAndOverride.mockReturnValue(null)
    findUnique.mockResolvedValue({ ...freshSession, expiresAt: new Date(Date.now() - 1000) })
    await expectStepUp(ctx(principal))
  })

  it('fails closed when the session belongs to another user', async () => {
    reflector.getAllAndOverride.mockReturnValue(null)
    findUnique.mockResolvedValue({ ...freshSession, userId: 'someone-else' })
    await expectStepUp(ctx(principal))
  })

  it('fails closed when lastAuthAt is NULL (pre-migration row)', async () => {
    reflector.getAllAndOverride.mockReturnValue(null)
    findUnique.mockResolvedValue({ ...freshSession, lastAuthAt: null })
    await expectStepUp(ctx(principal))
  })

  it('fails closed when lastAuthAt is older than the window', async () => {
    reflector.getAllAndOverride.mockReturnValue(null) // window = env default 600s
    findUnique.mockResolvedValue({ ...freshSession, lastAuthAt: new Date(Date.now() - 601_000) })
    await expectStepUp(ctx(principal))
  })

  it('uses a per-route maxAge override instead of the env default', async () => {
    reflector.getAllAndOverride.mockReturnValue(60) // 60s window
    findUnique.mockResolvedValue({ ...freshSession, lastAuthAt: new Date(Date.now() - 120_000) })

    await expectStepUp(ctx(principal))
    expect(env.get).not.toHaveBeenCalled()
  })
})
