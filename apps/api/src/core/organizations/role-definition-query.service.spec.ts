import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { RequestPrincipal } from '@amcore/shared'
import { SystemRole } from '@amcore/shared'

import { AppException, NotFoundException } from '../../common/exceptions'
import type { PrismaService } from '../../prisma'

import { RoleDefinitionQueryService } from './role-definition-query.service'

import type { PrismaClient } from '@/generated/prisma/client'

const principal: RequestPrincipal = {
  type: 'jwt',
  sub: 'user-1',
  email: 'a@example.test',
  systemRole: SystemRole.User,
  organizationId: 'org-1',
  aclVersion: 0,
}

describe('RoleDefinitionQueryService read failures', () => {
  let prisma: DeepMockProxy<PrismaClient>
  let service: RoleDefinitionQueryService
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    service = new RoleDefinitionQueryService(prisma as unknown as PrismaService)
  })

  it('turns an unexpected snapshot failure into the single ROLE_READ_UNAVAILABLE (503)', async () => {
    ;(prisma.$transaction as unknown as jest.Mock).mockRejectedValue(new Error('connection reset'))
    for (const call of [
      () => service.list('org-1', 'org-1', { page: 1, limit: 20 }),
      () => service.detail('org-1', 'role-1', principal),
    ]) {
      const error = await call().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(AppException)
      expect(error).toMatchObject({ errorCode: 'ROLE_READ_UNAVAILABLE' })
      expect((error as AppException).getStatus()).toBe(503)
    }
  })

  it('lets a deliberate semantic rejection through unchanged', async () => {
    ;(prisma.$transaction as unknown as jest.Mock).mockRejectedValue(new NotFoundException('gone'))
    await expect(service.detail('org-1', 'role-1', principal)).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('refuses a selector that does not match the actor organization before reading', async () => {
    await expect(service.list('org-2', 'org-1', { page: 1, limit: 20 })).rejects.toBeInstanceOf(
      AppException
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
