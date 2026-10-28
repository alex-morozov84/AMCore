import type { MfaPurpose } from '@amcore/shared'

import type { BrowserAuthContext, MfaFlow, Prisma } from '../../../generated/prisma/client.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import { admitsContinuation } from './mfa-continuation.js'
import { validRecoverySetup } from './mfa-recovery-ticket.js'
import { mfaHash } from './mfa-secrets.js'
import type { SessionFamilyAuthority } from './mfa-session-authority.js'
import { validSetupSuccessor } from './mfa-setup-transfer.js'
import { lockMfaAccounts, mfaDatabaseClock } from './mfa-transaction.js'

export interface FlowRequest {
  credential: string
  purpose: MfaPurpose
  audience: string
  bindingHash: string
  browser: BrowserRequestBinding | null
}

export interface LockedMfaFlow {
  flow: MfaFlow
  source: SessionFamilyAuthority | null
  context: BrowserAuthContext | null
  now: Date
}

export function continuationHash(credential: string): string | null {
  return /^[A-Za-z0-9_-]{43}$/.test(credential)
    ? mfaHash(JSON.stringify(['mfa-continuation-v1', credential]))
    : null
}

/** Direct clients derive their private flow binding from the opaque credential, never from Origin. */
export function directFlowBinding(credential: string): string | null {
  return /^[A-Za-z0-9_-]{43}$/.test(credential)
    ? mfaHash(JSON.stringify(['mfa-direct-binding-v1', credential]))
    : null
}

export function matchesFlowBrowser(
  flow: MfaFlow,
  context: BrowserAuthContext | null,
  request: FlowRequest,
  now: Date
): boolean {
  if (!flow.browserContextId)
    return flow.publicationGeneration === null && request.browser === null && context === null
  const binding = request.browser
  if (
    !binding ||
    !context ||
    context.id !== flow.browserContextId ||
    binding.contextId !== context.id ||
    binding.bindingHash !== context.bindingHash ||
    request.bindingHash !== context.bindingHash ||
    binding.audience !== context.audience ||
    request.audience !== context.audience ||
    binding.generation !== context.generation ||
    flow.publicationGeneration !== context.generation ||
    context.expiresAt <= now
  )
    return false
  return flow.authorityKind === 'session'
    ? context.state === 'published' && context.currentFamilyId === flow.sourceFamilyId
    : context.state === 'reserved' && context.reservedFlowId === flow.id
}

/** Context → account coordination → flow. Every source-family writer shares the account lock. */
export async function lockMfaFlow(
  tx: Prisma.TransactionClient,
  request: FlowRequest,
  options: { recoveryPending?: boolean } = {}
): Promise<LockedMfaFlow | null> {
  const credentialHash = continuationHash(request.credential)
  if (!credentialHash) return null
  const hint = await tx.mfaFlow.findUnique({ where: { credentialHash } })
  if (!hint) return null
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  if (hint.browserContextId) {
    if (request.browser?.contextId !== hint.browserContextId) return null
    await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${hint.browserContextId} FOR UPDATE`
  } else if (request.browser) return null
  await lockMfaAccounts(tx, [hint.userId])
  const users = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM core.users WHERE id = ${hint.userId} FOR SHARE`
  if (!users.length) return null
  await tx.$queryRaw`SELECT id FROM core.mfa_flows WHERE id = ${hint.id} FOR UPDATE`
  const flow = await tx.mfaFlow.findUnique({ where: { credentialHash } })
  if (
    !flow ||
    flow.id !== hint.id ||
    flow.userId !== hint.userId ||
    flow.browserContextId !== hint.browserContextId
  )
    return null
  const account = await tx.mfaAccount.findUnique({ where: { userId: flow.userId } })
  if (!account) return null
  const source = flow.sourceFamilyId
    ? await tx.authSessionFamily.findUnique({ where: { id: flow.sourceFamilyId } })
    : null
  const context = flow.browserContextId
    ? await tx.browserAuthContext.findUnique({ where: { id: flow.browserContextId } })
    : null
  const now = await mfaDatabaseClock(tx)
  const authority =
    flow.authorityKind === 'setup_successor'
      ? admitsContinuation(
          { ...flow, authorityKind: 'identity' },
          request,
          account.securityVersion,
          null,
          now
        ) && (await validSetupSuccessor(tx, flow, context, now))
      : flow.authorityKind === 'recovery_setup'
        ? admitsContinuation(
            { ...flow, authorityKind: 'identity' },
            request,
            account.securityVersion,
            null,
            now
          ) && (await validRecoverySetup(tx, flow, now))
        : options.recoveryPending && flow.authorityKind === 'recovery_pending'
          ? flow.purpose === 'initial_setup' &&
            account.required &&
            account.emergencyRequired &&
            !account.setupComplete &&
            !(await tx.mfaFactor.findUnique({
              where: { userId: flow.userId },
              select: { id: true },
            })) &&
            admitsContinuation(
              { ...flow, authorityKind: 'identity' },
              request,
              account.securityVersion,
              null,
              now
            )
          : admitsContinuation(flow, request, account.securityVersion, source, now)
  if (!authority || !matchesFlowBrowser(flow, context, request, now)) return null
  if (
    source &&
    (source.browserContextId !== flow.browserContextId ||
      source.publicationGeneration !== flow.publicationGeneration)
  )
    return null
  return { flow, source, context, now }
}
