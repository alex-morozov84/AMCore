import type { PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { SystemRole } from '@amcore/shared'

import type { PrismaService } from '../../prisma'

import { PrivilegedRoleService } from './privileged-role.service'

describe('PrivilegedRoleService', () => {
  let service: PrivilegedRoleService
  let prisma: DeepMockProxy<PrismaClient>

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    service = new PrivilegedRoleService(prisma as unknown as PrismaService)
  })

  it('returns the current systemRole read directly from the DB', async () => {
    prisma.user.findUnique.mockResolvedValue({ systemRole: 'SUPER_ADMIN' } as never)

    await expect(service.getCurrentSystemRole('user-1')).resolves.toBe(SystemRole.SuperAdmin)
  })

  it('selects only systemRole by id (no other columns read)', async () => {
    prisma.user.findUnique.mockResolvedValue({ systemRole: 'USER' } as never)

    await service.getCurrentSystemRole('user-1')

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { systemRole: true },
    })
  })

  it('returns null when the user row is absent (fail-closed signal)', async () => {
    prisma.user.findUnique.mockResolvedValue(null)

    await expect(service.getCurrentSystemRole('gone')).resolves.toBeNull()
  })

  it('does not catch DB errors — they propagate to the caller', async () => {
    const infraError = new Error('pool timeout')
    prisma.user.findUnique.mockRejectedValue(infraError)

    await expect(service.getCurrentSystemRole('user-1')).rejects.toBe(infraError)
  })
})
