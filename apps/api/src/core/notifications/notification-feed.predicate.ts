import { NotificationChannel } from './notification.constants'

import { NotificationDeliveryStatus, type Prisma } from '@/generated/prisma/client'

/**
 * The ONE definition of "what is in a user's in-app feed" (ADR-052 §§2/9): a canonical
 * `Notification` is feed-visible only if one of ITS persisted deliveries is a `DELIVERED` `in_app`
 * delivery — i.e. the in-app channel was actually selected at produce time (mandatory, or optional
 * with the master toggle/category preference on). An external-only or opted-out notification keeps
 * its canonical record but never appears in the feed, the unread count or any feed mutation.
 *
 * Eligibility is the set of delivery rows written when the notification was produced: a later
 * preference toggle neither hides earlier eligible rows nor reveals ineligible ones.
 *
 * Used by `getFeed`, `getUnreadCount`, `markRead`, `markAllRead` and `archive`, so the page, the
 * count, the realtime hints and the mutations can never disagree. `conditions` (unread, a single
 * id, the keyset cursor) are ANDed AFTER the base — nothing a caller passes can override the
 * recipient, the non-archived or the eligibility constraint.
 */
export function inAppFeedWhere(
  userId: string,
  ...conditions: Prisma.NotificationWhereInput[]
): Prisma.NotificationWhereInput {
  return {
    AND: [
      {
        recipientUserId: userId,
        archivedAt: null,
        deliveries: {
          some: {
            channel: NotificationChannel.IN_APP,
            status: NotificationDeliveryStatus.DELIVERED,
          },
        },
      },
      ...conditions,
    ],
  }
}
