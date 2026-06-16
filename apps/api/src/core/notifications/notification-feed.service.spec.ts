import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { PrismaService } from '../../prisma'

import { NotificationDefinitionRegistry } from './notification-definition.registry'
import { NotificationFeedService } from './notification-feed.service'
import { decodeFeedCursor } from './notification-feed-cursor'

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'n1',
    type: 'account.profile_updated',
    category: 'account',
    schemaVersion: 1,
    payload: { updatedFields: ['name'] },
    action: null,
    createdAt: new Date('2026-06-15T10:00:00.000Z'),
    readAt: null,
    archivedAt: null,
    ...overrides,
  }
}

describe('NotificationFeedService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let service: NotificationFeedService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    service = new NotificationFeedService(prisma, new NotificationDefinitionRegistry())
    prisma.user.findUnique.mockResolvedValue({ locale: 'en' } as never)
  })

  describe('getFeed', () => {
    it('renders items in the recipient locale and reports no more when within limit', async () => {
      prisma.notification.findMany.mockResolvedValue([row()] as never)

      const result = await service.getFeed('user-1', { limit: 20 })

      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
      expect(result.data[0]).toMatchObject({
        id: 'n1',
        type: 'account.profile_updated',
        title: 'Profile updated',
        readAt: null,
      })
    })

    it('sets hasMore and a decodable nextCursor when the page is full', async () => {
      const rows = [
        row({ id: 'a', createdAt: new Date('2026-06-15T10:00:00.000Z') }),
        row({ id: 'b', createdAt: new Date('2026-06-15T09:00:00.000Z') }),
      ]
      prisma.notification.findMany.mockResolvedValue(rows as never)

      const result = await service.getFeed('user-1', { limit: 1 })

      expect(result.hasMore).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(decodeFeedCursor(result.nextCursor as string).id).toBe('a')
    })

    it('applies a keyset predicate when a cursor is supplied', async () => {
      prisma.notification.findMany.mockResolvedValue([] as never)
      const cursor = Buffer.from(
        JSON.stringify({ c: '2026-06-15T10:00:00.000Z', i: 'x' })
      ).toString('base64url')

      await service.getFeed('user-1', { cursor: `v1.${cursor}`, limit: 20 })

      const where = prisma.notification.findMany.mock.calls[0]![0]!.where as { OR?: unknown }
      expect(where.OR).toBeDefined()
    })

    it('falls back to a neutral rendering for an unregistered type', async () => {
      prisma.notification.findMany.mockResolvedValue([row({ type: 'gone.removed' })] as never)

      const result = await service.getFeed('user-1', { limit: 20 })

      expect(result.data[0]).toMatchObject({
        type: 'gone.removed',
        title: 'gone.removed',
        body: '',
      })
    })
  })

  describe('mutations', () => {
    it('counts only unread, non-archived notifications', async () => {
      prisma.notification.count.mockResolvedValue(3)

      expect(await service.getUnreadCount('user-1')).toBe(3)
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { recipientUserId: 'user-1', readAt: null, archivedAt: null },
      })
    })

    it('marks one read scoped to the recipient and unread state', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 } as never)

      await service.markRead('user-1', 'n1')

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', recipientUserId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      })
    })

    it('returns how many were marked all-read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 } as never)

      expect(await service.markAllRead('user-1')).toBe(4)
    })

    it('archives scoped to the recipient', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 } as never)

      await service.archive('user-1', 'n1')

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', recipientUserId: 'user-1', archivedAt: null },
        data: { archivedAt: expect.any(Date) },
      })
    })
  })
})
