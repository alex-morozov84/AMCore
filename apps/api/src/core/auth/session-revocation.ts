import type { Prisma } from '../../generated/prisma/client.js'
import type { PrismaService } from '../../prisma/index.js'

import type { BrowserRequestBinding } from './mfa/browser-binding.js'
import { readRefreshAuthority, refreshSessionChanged } from './mfa/mfa-refresh-authority.js'
import { lockMfaAccounts } from './mfa/mfa-transaction.js'

/** Family authority remains as a tombstone even when the own-session API deletes its token rows. */
export async function deleteOwnedSession(
  db: PrismaService,
  userId: string,
  sessionId: string
): Promise<boolean> {
  return db.$transaction(
    async (tx) => {
      const now = await lockMfaAccounts(tx, [userId])
      const session = await tx.session.findFirst({ where: { id: sessionId, userId } })
      if (!session) return false
      await retireFamilies(tx, userId, now, { id: session.familyId })
      await tx.session.deleteMany({ where: { userId, familyId: session.familyId } })
      return true
    },
    { maxWait: 2000, timeout: 4000 }
  )
}

export async function deleteRefreshFamily(db: PrismaService, hashedToken: string): Promise<void> {
  const hint = await db.session.findUnique({ where: { refreshToken: hashedToken } })
  if (!hint) return
  await db.$transaction(
    async (tx) => {
      const now = await lockMfaAccounts(tx, [hint.userId])
      const current = await tx.session.findUnique({ where: { refreshToken: hashedToken } })
      if (!current || current.userId !== hint.userId || current.familyId !== hint.familyId) return
      const family = await tx.authSessionFamily.findUnique({ where: { id: current.familyId } })
      // Omitted private headers cannot turn browser logout into legacy direct-client revocation.
      if (family?.browserContextId) throw refreshSessionChanged()
      await retireFamilies(tx, hint.userId, now, { id: current.familyId })
      await tx.session.deleteMany({ where: { userId: hint.userId, familyId: current.familyId } })
    },
    { maxWait: 2000, timeout: 4000 }
  )
}

/** Revocation does not change the account epoch or independently authorized pre-login flows. */
export async function deleteOwnedFamilies(
  db: PrismaService,
  userId: string,
  keepRefreshHash?: string,
  browser: BrowserRequestBinding | null = null
): Promise<number> {
  return db.$transaction(
    async (tx) => {
      const now = await lockMfaAccounts(tx, [userId])
      const keep = keepRefreshHash
        ? await tx.session.findUnique({ where: { refreshToken: keepRefreshHash } })
        : null
      if (
        keepRefreshHash &&
        (!keep || keep.userId !== userId || keep.revokedAt || keep.expiresAt <= now)
      )
        throw refreshSessionChanged()
      if (keep) await readRefreshAuthority(tx, keep, browser)
      const other = keep ? { not: keep.familyId } : undefined
      await retireFamilies(tx, userId, now, other ? { id: other } : {})
      const result = await tx.session.deleteMany({
        where: { userId, ...(other && { familyId: other }) },
      })
      return result.count
    },
    { maxWait: 2000, timeout: 4000 }
  )
}

async function retireFamilies(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  selector: Pick<Prisma.AuthSessionFamilyWhereInput, 'id'>
): Promise<void> {
  await tx.authSessionFamily.updateMany({
    where: { userId, revokedAt: null, ...selector },
    data: { revokedAt: now, publicationState: 'retired' },
  })
}
