import { Injectable } from '@nestjs/common'

import type {
  BrowserLogoutReceiptInput,
  BrowserLogoutReceiptLookup,
  BrowserLogoutReceiptResult,
  BrowserReturnProof,
} from '@amcore/shared'

import { PrismaService } from '../../../prisma/index.js'
import { hashRefreshToken } from '../utils/refresh-token-hash.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import {
  assertLogoutReceipt,
  logoutReceiptHash,
  logoutReceiptView,
} from './browser-logout-receipt.js'
import { assertSelectedRefresh, lockLogout, retireGeneration } from './browser-session-logout.js'
import { settingsSourceChanged } from './mfa-settings-source.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

@Injectable()
export class BrowserLogoutReceiptService {
  constructor(private readonly db: PrismaService) {}

  async resolve(
    binding: BrowserRequestBinding,
    input: BrowserLogoutReceiptLookup,
    mutation?: BrowserLogoutReceiptInput,
    claim?: BrowserReturnProof
  ): Promise<BrowserLogoutReceiptResult> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
        await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${binding.contextId} FOR UPDATE`
        const existing = await tx.browserLogoutReceipt.findUnique({
          where: { operationId: input.operationId },
        })
        if (existing) {
          assertLogoutReceipt(existing, input, binding)
          if (!claim) return logoutReceiptView(tx, existing)
          await lockMfaAccounts(tx, [existing.userId])
          const view = await logoutReceiptView(tx, existing)
          if (existing.neutralAttemptId === claim.neutralAttemptId) return view
          if (
            existing.neutralAttemptId ||
            view.state !== 'logged_out' ||
            binding.generation !== existing.afterGeneration
          )
            throw settingsSourceChanged()
          const retained = await tx.browserLogoutReceipt.update({
            where: { operationId: existing.operationId },
            data: { neutralAttemptId: claim.neutralAttemptId },
          })
          return logoutReceiptView(tx, retained)
        }
        if (!mutation)
          return {
            state: 'not_found',
            operationId: input.operationId,
            returnEntryId: input.returnEntryId,
          }
        if (!mutation.refreshToken) throw settingsSourceChanged()
        const { context, familyIds, now } = await lockLogout(tx, binding)
        const refreshHash = hashRefreshToken(mutation.refreshToken)
        await assertSelectedRefresh(tx, context, refreshHash)
        const session = await tx.session.findUnique({ where: { refreshToken: refreshHash } })
        const family = session?.familyId
          ? await tx.authSessionFamily.findUnique({ where: { id: session.familyId } })
          : null
        const account = session
          ? await tx.mfaAccount.findUnique({ where: { userId: session.userId } })
          : null
        const expiresAt = new Date(mutation.expiresAt)
        if (
          !session ||
          !family ||
          !account ||
          family.securityVersion !== account.securityVersion ||
          context.state !== 'published' ||
          family.revokedAt ||
          session.expiresAt <= now ||
          expiresAt <= now ||
          expiresAt.getTime() > now.getTime() + 900000
        )
          throw settingsSourceChanged()
        const after = await retireGeneration(tx, context, familyIds, now)
        const receipt = await tx.browserLogoutReceipt.create({
          data: {
            operationId: input.operationId,
            returnEntryId: input.returnEntryId,
            credentialHash: logoutReceiptHash(input.receiptSecret),
            userId: session.userId,
            sourceFamilyId: family.id,
            sourceSessionId: session.id,
            securityVersion: family.securityVersion,
            contextId: context.id,
            audience: context.audience,
            bindingHash: context.bindingHash,
            beforeGeneration: context.generation,
            afterGeneration: after.generation,
            expiresAt,
          },
        })
        if (expiresAt <= (await mfaDatabaseClock(tx))) throw settingsSourceChanged()
        return logoutReceiptView(tx, receipt)
      },
      { maxWait: 2000, timeout: 4000 }
    )
  }
}
