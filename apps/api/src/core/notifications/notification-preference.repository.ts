import { Injectable } from '@nestjs/common'
import type { NotificationPreference } from '@prisma/client'

import { PrismaService } from '../../prisma'

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

  findByUser(userId: string): Promise<NotificationPreference[]> {
    return this.prisma.notificationPreference.findMany({ where: { userId } })
  }

  async getMasterToggle(userId: string): Promise<boolean> {
    const settings = await this.prisma.userSettings.findUnique({
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
}
