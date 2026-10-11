import type { WorkReason } from '@amcore/shared'

import type { NotificationDelivery, Prisma } from '@/generated/prisma/client'

export interface NotificationControlTarget {
  readonly channel: string
  validateDelivery(
    tx: Prisma.TransactionClient,
    delivery: NotificationDelivery,
    recipientUserId: string
  ): Promise<WorkReason | null>
}
