import type { PrismaService } from '../../prisma'

import { AdminDetailService } from './admin-detail.service'

const id = 'clz1234560000abcdefghijk'
const date = new Date('2026-01-01T00:00:00.000Z')

describe('AdminDetailService', () => {
  it('reads safe user detail, count and bounded memberships in one snapshot', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id,
          email: 'ada@example.test',
          emailVerified: true,
          name: 'Ada',
          avatarUrl: null,
          phone: null,
          locale: 'en',
          timezone: null,
          systemRole: 'USER',
          createdAt: date,
          updatedAt: date,
          lastLoginAt: null,
          passwordHash: 'must-not-leak',
        }),
      },
      orgMember: {
        count: jest.fn().mockResolvedValue(30),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    const prisma = {
      $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
    } as unknown as PrismaService
    const result = await new AdminDetailService(prisma).user(id, {
      page: 2,
      limit: 10,
      search: undefined,
    })
    expect(result.user).not.toHaveProperty('passwordHash')
    expect(result.memberships).toMatchObject({ total: 30, page: 2, limit: 10 })
    expect(result.membershipCount).toBe(30)
    expect(tx.orgMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    )
    expect((prisma.$transaction as jest.Mock).mock.calls[0][1]).toMatchObject({
      isolationLevel: 'RepeatableRead',
    })
  })

  it('filters all user memberships by organization name or slug', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id,
          email: 'ada@example.test',
          emailVerified: true,
          name: 'Ada',
          avatarUrl: null,
          phone: null,
          locale: 'en',
          timezone: null,
          systemRole: 'USER',
          createdAt: date,
          updatedAt: date,
          lastLoginAt: null,
        }),
      },
      orgMember: {
        count: jest.fn().mockResolvedValueOnce(20).mockResolvedValueOnce(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    const prisma = {
      $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
    } as unknown as PrismaService
    const result = await new AdminDetailService(prisma).user(id, {
      page: 1,
      limit: 10,
      search: 'North%',
    })
    expect(result.membershipCount).toBe(20)
    expect(result.memberships.total).toBe(1)
    expect(tx.orgMember.count.mock.calls[1][0].where.organization.OR).toEqual([
      { name: { contains: 'North\\%', mode: 'insensitive' } },
      { slug: { contains: 'North\\%', mode: 'insensitive' } },
    ])
  })

  it('searches the full organization membership set and keeps total count separate', async () => {
    const tx = {
      organization: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id, name: 'Acme', slug: 'acme', createdAt: date, updatedAt: date }),
      },
      orgMember: {
        count: jest.fn().mockResolvedValueOnce(100).mockResolvedValueOnce(2),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    const prisma = {
      $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
    } as unknown as PrismaService
    const result = await new AdminDetailService(prisma).organization(id, {
      page: 1,
      limit: 20,
      search: '100%',
    })
    expect(result.memberCount).toBe(100)
    expect(result.members.total).toBe(2)
    expect(tx.orgMember.count).toHaveBeenNthCalledWith(1, { where: { organizationId: id } })
    expect(tx.orgMember.count.mock.calls[1][0].where.user.OR).toEqual([
      { name: { contains: '100\\%', mode: 'insensitive' } },
      { email: { contains: '100\\%', mode: 'insensitive' } },
    ])
    expect(tx.orgMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    )
  })

  it('returns 404 for a valid missing user instead of reading memberships', async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      orgMember: { count: jest.fn(), findMany: jest.fn() },
    }
    const prisma = {
      $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
    } as unknown as PrismaService
    await expect(
      new AdminDetailService(prisma).user(id, {
        page: 1,
        limit: 20,
        search: undefined,
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(tx.orgMember.count).not.toHaveBeenCalled()
  })
})
