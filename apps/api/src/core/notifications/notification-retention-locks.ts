import { type NotificationDelivery, Prisma } from '@/generated/prisma/client'

/** Parents are already exclusively locked. Lock every sibling globally by ID. */
export async function lockRetentionChildren(
  tx: Prisma.TransactionClient,
  parentIds: string[]
): Promise<{ rows: NotificationDelivery[]; parentIds: string[] }> {
  if (!parentIds.length) return { rows: [], parentIds }
  const ids = await tx.notificationDelivery.findMany({
    where: { notificationId: { in: parentIds } },
    select: { id: true, notificationId: true },
    orderBy: [{ notificationId: 'asc' }, { id: 'asc' }],
    take: 4097,
  })
  const boundary = ids.length > 4096 ? ids[4096]!.notificationId : undefined
  const admitted = boundary ? parentIds.filter((id) => id < boundary) : parentIds
  const selected = ids.filter((row) => admitted.includes(row.notificationId))
  if (!selected.length) return { rows: [], parentIds: admitted }
  const rows = await tx.$queryRaw<
    NotificationDelivery[]
  >(Prisma.sql`SELECT * FROM notifications.notification_deliveries
    WHERE id IN (${Prisma.join(selected.map((row) => row.id))}) ORDER BY id FOR UPDATE`)
  return { rows, parentIds: admitted }
}

export function protectsNotification(row: NotificationDelivery): boolean {
  return (
    ['PENDING', 'PROCESSING', 'RETRY_SCHEDULED'].includes(row.status) ||
    row.unresolvedEffectCount > 0 ||
    row.legacyUnverified ||
    row.manualGrant === 'reserved'
  )
}
