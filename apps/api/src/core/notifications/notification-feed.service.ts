import { Injectable } from '@nestjs/common'
import type { Notification } from '@prisma/client'

import {
  DEFAULT_LOCALE,
  type NotificationAction,
  type NotificationFeedItem,
  type NotificationFeedResponse,
  type SupportedLocale,
} from '@amcore/shared'

import { PrismaService } from '../../prisma'

import { NotificationDefinitionRegistry } from './notification-definition.registry'
import { decodeFeedCursor, encodeFeedCursor } from './notification-feed-cursor'

export interface FeedQuery {
  cursor?: string
  limit: number
}

/**
 * Read model for the in-app feed (Arc A.6). Renders `title`/`body` server-side from
 * the structured payload in the recipient's CURRENT locale at read time (ADR-052),
 * and pages with a keyset cursor over `(createdAt DESC, id DESC)`.
 */
@Injectable()
export class NotificationFeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationDefinitionRegistry
  ) {}

  async getFeed(userId: string, query: FeedQuery): Promise<NotificationFeedResponse> {
    const cursor = query.cursor ? decodeFeedCursor(query.cursor) : null
    const locale = await this.recipientLocale(userId)

    const rows = await this.prisma.notification.findMany({
      where: {
        recipientUserId: userId,
        archivedAt: null,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })

    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    const last = page.at(-1)

    return {
      data: page.map((row) => this.toFeedItem(row, locale)),
      nextCursor:
        hasMore && last ? encodeFeedCursor({ createdAt: last.createdAt, id: last.id }) : null,
      hasMore,
    }
  }

  getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientUserId: userId, readAt: null, archivedAt: null },
    })
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    // Scoped to the recipient and idempotent: a foreign or already-read id is a no-op.
    await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    })
  }

  async markAllRead(userId: string): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, readAt: null, archivedAt: null },
      data: { readAt: new Date() },
    })
    return count
  }

  async archive(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientUserId: userId, archivedAt: null },
      data: { archivedAt: new Date() },
    })
  }

  private async recipientLocale(userId: string): Promise<SupportedLocale> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    })
    return (user?.locale ?? DEFAULT_LOCALE) as SupportedLocale
  }

  private toFeedItem(row: Notification, locale: SupportedLocale): NotificationFeedItem {
    // Resilient to a stored type whose definition a fork later removed: fall back to a
    // neutral rendering rather than failing the whole feed.
    const rendered = this.registry.has(row.type)
      ? this.registry.get(row.type).renderInApp(row.payload, locale)
      : { title: row.type, body: '' }

    return {
      id: row.id,
      type: row.type,
      category: row.category,
      title: rendered.title,
      body: rendered.body,
      action: (row.action as NotificationAction | null) ?? null,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }
  }
}
