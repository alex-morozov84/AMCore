import { Prisma } from '@/generated/prisma/client'

export type NotificationEffectCertainty = 'none' | 'accepted' | 'unknown'

/** Commit possible I/O before transport. A crash after this point remains unknown. */
export async function markNotificationTransport(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  leaseToken: string
): Promise<void> {
  const changed = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE notifications.notification_delivery_attempts
    SET "effectState" = 'possible', "transportStartedAt" = clock_timestamp()
    WHERE "deliveryId" = ${deliveryId} AND "leaseToken" = ${leaseToken}
      AND outcome IS NULL AND "effectState" = 'not_started'
    RETURNING id
  `)
  if (changed.length !== 1) throw new Error('notification_transport_witness_conflict')
  await tx.notificationDelivery.update({
    where: { id: deliveryId },
    data: { unresolvedEffectCount: { increment: 1 }, controlRevision: { increment: 1 } },
  })
}

/** Resolve only this attempt's possible call, never another attempt's uncertainty. */
export async function settleNotificationEffect(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  leaseToken: string,
  certainty: NotificationEffectCertainty
): Promise<void> {
  const changed = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE notifications.notification_delivery_attempts
    SET "effectState" = ${certainty === 'none' ? 'proven_none' : certainty}
    WHERE "deliveryId" = ${deliveryId} AND "leaseToken" = ${leaseToken}
      AND "effectState" = 'possible'
    RETURNING id
  `)
  if (!changed.length || certainty === 'unknown') return
  if (changed.length !== 1) throw new Error('notification_effect_witness_conflict')
  await tx.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      unresolvedEffectCount: { decrement: 1 },
      ...(certainty === 'accepted' ? { acceptedSeen: true } : {}),
    },
  })
}
