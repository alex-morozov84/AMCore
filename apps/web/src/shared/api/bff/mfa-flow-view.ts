import { type MfaBrowserView, mfaStatusSchema } from '@amcore/shared'

import { type BrowserAuthAttempt, type BrowserAuthPublication } from './browser-auth-attempt'
import { postBrowserAuth } from './browser-auth-upstream'
import { changedBrowserContext, unavailableBrowserContext } from './browser-binding.server'
import type { ProductWebContext } from './product-web-context.server'
import type { VaultEntry } from './session-vault.types'

import 'server-only'

export function flowView(
  record: Extract<BrowserAuthAttempt, { flow: unknown }>,
  state = record.flow.state
): MfaBrowserView {
  return {
    kind: 'flow',
    ...(record.invitation ? { invitationFlowId: record.invitation.flowId } : {}),
    ...(record.flow.returnTo ? { returnTo: record.flow.returnTo } : {}),
    state,
    accountLabel: record.accountLabel,
    flowBinding: record.id,
    purpose: record.flow.purpose,
    expiresAt: new Date(
      Math.min(record.expiresAt, Date.parse(record.flow.expiresAt))
    ).toISOString(),
    requiredProofs: state === 'ready' || state === 'completed' ? [] : record.flow.requiredProofs,
    remainingCodes: record.flow.remainingCodes,
    generation: record.flow.generation,
  }
}

export async function currentFlowView(
  request: Request,
  context: ProductWebContext,
  record: Extract<BrowserAuthAttempt, { flow: unknown }>
): Promise<MfaBrowserView> {
  if (record.flow.nextAction === 'recovery_ticket')
    return { kind: 'recovery_ticket', accountLabel: record.accountLabel, flowBinding: record.id }
  const result = await postBrowserAuth(
    request,
    context,
    record,
    '/auth/mfa/status',
    { purpose: record.flow.purpose },
    record.flow.continuation
  )
  const status = mfaStatusSchema.safeParse(result.body)
  if (result.status !== 200 || !status.success) throw unavailableBrowserContext()
  return {
    ...status.data,
    expiresAt: new Date(
      Math.min(record.expiresAt, Date.parse(status.data.expiresAt))
    ).toISOString(),
    kind: 'flow',
    accountLabel: record.accountLabel,
    flowBinding: record.id,
    ...(record.invitation ? { invitationFlowId: record.invitation.flowId } : {}),
    ...(record.flow.returnTo ? { returnTo: record.flow.returnTo } : {}),
  }
}

export async function stagedEntry(
  context: ProductWebContext,
  record: BrowserAuthPublication
): Promise<VaultEntry> {
  const entry = await context.store.get(record.vaultId)
  const binding = entry?.browser
  if (
    !entry ||
    !binding ||
    entry.audience !== context.audience ||
    binding.familyId !== record.familyId ||
    binding.securityVersion !== record.securityVersion ||
    binding.contextId !== record.browser.contextId ||
    binding.generation !== record.browser.generation
  )
    throw changedBrowserContext()
  // A pending entry is usable only by the restricted settlement path. Published recovery checks primary below.
  return entry
}
