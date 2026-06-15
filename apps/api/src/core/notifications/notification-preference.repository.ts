import { Injectable } from '@nestjs/common'
import type { NotificationPreference, Prisma } from '@prisma/client'

import { PrismaService } from '../../prisma'

/** A Prisma client or an active transaction client. */
type DbClient = PrismaService | Prisma.TransactionClient

/**
 * Persistence for user notification preferences (a `notifications`-schema table)
 * and the master optional toggle.
 *
 * The master toggle is `UserSettings.notificationsEnabled` (ADR-052 / cold-review
 * finding 4): the notifications subsystem is its only consumer, so this repository
 * owns access to that single field. A `UserSettings` row may not exist yet (the
 * table is otherwise unused) — absence reads as `true`, matching the column default.
 */
@Injectable()
export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Reads accept an optional client so a producer can run them inside the caller's
  // transaction (notifyTx), keeping resolution consistent with that transaction.
  findByUser(userId: string, client: DbClient = this.prisma): Promise<NotificationPreference[]> {
    return client.notificationPreference.findMany({ where: { userId } })
  }

  async getMasterToggle(userId: string, client: DbClient = this.prisma): Promise<boolean> {
    const settings = await client.userSettings.findUnique({
      where: { userId },
      select: { notificationsEnabled: true },
    })
    return settings?.notificationsEnabled ?? true
  }

  async upsertPreference(
    userId: string,
    category: string,
    channel: string,
    enabled: boolean
  ): Promise<void> {
    await this.prisma.notificationPreference.upsert({
      where: { userId_category_channel: { userId, category, channel } },
      create: { userId, category, channel, enabled },
      update: { enabled },
    })
  }

  /**
   * Write the master toggle. The `UserSettings` row may not exist yet (the table is
   * otherwise unused), so upsert it; non-notification columns keep their defaults.
   */
  async setMasterToggle(userId: string, enabled: boolean): Promise<void> {
    await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, notificationsEnabled: enabled },
      update: { notificationsEnabled: enabled },
    })
  }
}
