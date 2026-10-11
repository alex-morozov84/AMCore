import { Prisma } from '@/generated/prisma/client'

/** Shared until claim commit; pause takes the conflicting exclusive row lock. */
export async function notificationClaimsAllowed(tx: Prisma.TransactionClient): Promise<boolean> {
  await tx.$queryRaw`SELECT set_config('lock_timeout', '500ms', true)`
  const rows = await tx.$queryRaw<{ paused: boolean }[]>(Prisma.sql`
    SELECT paused FROM notifications.notification_delivery_control WHERE id = 1 FOR SHARE
  `)
  if (!rows[0]) throw new Error('notification_claim_authority_missing')
  return !rows[0].paused
}
