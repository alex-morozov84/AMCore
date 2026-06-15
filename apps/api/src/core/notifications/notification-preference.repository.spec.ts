import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { PrismaService } from '../../prisma'

import { NotificationPreferenceRepository } from './notification-preference.repository'

describe('NotificationPreferenceRepository', () => {
  let prisma: DeepMockProxy<PrismaService>
  let repository: NotificationPreferenceRepository

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    repository = new NotificationPreferenceRepository(prisma)
  })

  describe('findByUser', () => {
    it('queries preferences scoped to the user', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([])

      await repository.findByUser('user-1')

      expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      })
    })
  })

  describe('getMasterToggle', () => {
    it('returns the stored value', async () => {
      prisma.userSettings.findUnique.mockResolvedValue({ notificationsEnabled: false } as never)

      expect(await repository.getMasterToggle('user-1')).toBe(false)
    })

    it('defaults to true when no settings row exists', async () => {
      prisma.userSettings.findUnique.mockResolvedValue(null)

      expect(await repository.getMasterToggle('user-1')).toBe(true)
    })
  })

  describe('upsertPreference', () => {
    it('upserts by the (userId, category, channel) compound key', async () => {
      prisma.notificationPreference.upsert.mockResolvedValue({} as never)

      await repository.upsertPreference('user-1', 'account', 'email', true)

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_category_channel: { userId: 'user-1', category: 'account', channel: 'email' },
        },
        create: { userId: 'user-1', category: 'account', channel: 'email', enabled: true },
        update: { enabled: true },
      })
    })
  })
})
