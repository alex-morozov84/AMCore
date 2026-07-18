import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { SystemRole } from '@amcore/shared'

import { BullBoardAuthService } from './bull-board-auth.service'

import type { PrismaClient } from '@/generated/prisma/client'
import type { PrismaService } from '@/prisma'

describe('BullBoardAuthService (read-only Bull Board verifier — EQS-01)', () => {
  let service: BullBoardAuthService
  let prisma: DeepMockProxy<PrismaClient>

  const future = new Date(Date.now() + 60_000)
  const past = new Date(Date.now() - 60_000)

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    service = new BullBoardAuthService(prisma as unknown as PrismaService)
  })

  it('authorizes a live SUPER_ADMIN session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      expiresAt: future,
      revokedAt: null,
      user: { systemRole: SystemRole.SuperAdmin },
    } as never)

    await expect(service.verifyAccess('raw-token')).resolves.toBe('authorized')
  })

  it('forbids a live session whose user is not SUPER_ADMIN', async () => {
    prisma.session.findUnique.mockResolvedValue({
      expiresAt: future,
      revokedAt: null,
      user: { systemRole: SystemRole.User },
    } as never)

    await expect(service.verifyAccess('raw-token')).resolves.toBe('forbidden')
  })

  it('treats a missing session as unauthenticated', async () => {
    prisma.session.findUnique.mockResolvedValue(null as never)

    await expect(service.verifyAccess('raw-token')).resolves.toBe('unauthenticated')
  })

  it('treats an expired session as unauthenticated', async () => {
    prisma.session.findUnique.mockResolvedValue({
      expiresAt: past,
      revokedAt: null,
      user: { systemRole: SystemRole.SuperAdmin },
    } as never)

    await expect(service.verifyAccess('raw-token')).resolves.toBe('unauthenticated')
  })

  it('treats a revoked session as unauthenticated', async () => {
    prisma.session.findUnique.mockResolvedValue({
      expiresAt: future,
      revokedAt: past,
      user: { systemRole: SystemRole.SuperAdmin },
    } as never)

    await expect(service.verifyAccess('raw-token')).resolves.toBe('unauthenticated')
  })

  it('is strictly read-only — never mutates session state (no rotation / revocation)', async () => {
    prisma.session.findUnique.mockResolvedValue({
      expiresAt: past, // expired: validateRefreshToken would delete this row
      revokedAt: null,
      user: { systemRole: SystemRole.SuperAdmin },
    } as never)

    await service.verifyAccess('raw-token')

    // The whole point of the dedicated verifier: a dashboard asset load must
    // not delete sessions or trigger reuse-detection family revocation.
    expect(prisma.session.delete).not.toHaveBeenCalled()
    expect(prisma.session.deleteMany).not.toHaveBeenCalled()
    expect(prisma.session.update).not.toHaveBeenCalled()
    expect(prisma.session.updateMany).not.toHaveBeenCalled()
  })
})
