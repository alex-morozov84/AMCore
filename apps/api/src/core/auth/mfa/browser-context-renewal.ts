import { AuthErrorCode, type BrowserAudience } from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import type { BrowserAuthContext } from '../../../generated/prisma/client.js'
import type { PrismaService } from '../../../prisma/index.js'

import { lockBrowserContext } from './browser-context.repository.js'
import { browserLoginParticipants } from './browser-login-participants.js'
import { retireGeneration } from './browser-session-logout.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

/** Renew only neutral state at the same known binding; no old-generation authority survives. */
export async function renewExpiredBrowserContext(
  db: PrismaService,
  binding: string,
  audience: BrowserAudience
): Promise<BrowserAuthContext> {
  return db.$transaction(
    async (tx) => {
      const context = await lockBrowserContext(tx, binding, audience)
      if (!context) throw changed()
      if (context.expiresAt > (await mfaDatabaseClock(tx))) return context
      if (context.generation >= 2147483647) throw changed()
      const participants = await browserLoginParticipants(tx, context)
      if (!participants) throw changed()
      const now = await lockMfaAccounts(tx, participants.owners)
      if (context.expiresAt > now) return context
      const retired = await retireGeneration(tx, context, participants.familyIds, now)
      const renewed = await tx.browserAuthContext.update({
        where: { id: context.id, generation: retired.generation },
        data: { expiresAt: new Date(now.getTime() + 900_000) },
      })
      if (renewed.expiresAt <= (await mfaDatabaseClock(tx))) throw changed()
      return renewed
    },
    { maxWait: 2000, timeout: 4000 }
  )
}

function changed(): AppException {
  return new AppException(
    'Browser authentication context changed',
    401,
    AuthErrorCode.AUTH_CONTEXT_CHANGED
  )
}
