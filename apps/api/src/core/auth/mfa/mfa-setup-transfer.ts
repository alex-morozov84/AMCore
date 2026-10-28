import { z } from 'zod'

import { browserAudienceSchema } from '@amcore/shared'

import type { BrowserAuthContext, MfaFlow, Prisma } from '../../../generated/prisma/client.js'

import { recoveryTicketAuthorizedPredecessor } from './mfa-recovery-ticket.js'
import { readSetupState } from './mfa-setup-state.js'

const event = z.object({ eventId: z.string().uuid(), verifiedAt: z.iso.datetime() }).strict()
export const setupTransferSchema = z
  .object({
    kind: z.literal('setup_transfer'),
    userId: z.string().min(1),
    predecessorFlowId: z.string().min(1),
    predecessorFamilyId: z.string().min(1).nullable(),
    successorFlowId: z.string().uuid(),
    previousSecurityVersion: z.number().int().nonnegative(),
    securityVersion: z.number().int().positive(),
    factorId: z.string().uuid(),
    factorVersion: z.number().int().positive(),
    generation: z.number().int().positive(),
    expiresAt: z.iso.datetime(),
    primary: event,
    secondFactor: event,
    previousMfaProofId: z.string().min(1).nullable(),
    browser: z
      .object({
        contextId: z.string().min(1),
        previousGeneration: z.number().int().nonnegative(),
        generation: z.number().int().positive(),
        bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
        audience: browserAudienceSchema,
      })
      .strict()
      .nullable(),
  })
  .strict()
export type SetupTransfer = z.infer<typeof setupTransferSchema>

/** Only a committed exact transfer replaces predecessor liveness. Never infer it from revocationReason. */
export async function validSetupSuccessor(
  tx: Prisma.TransactionClient,
  flow: MfaFlow,
  context: BrowserAuthContext | null,
  now: Date,
  phase: 'flow' | 'publication' = 'flow'
): Promise<boolean> {
  if (
    !flow.transferId ||
    flow.authorityKind !== 'setup_successor' ||
    flow.purpose !== 'initial_setup' ||
    flow.sourceFamilyId !== null ||
    flow.sourceSecurityVersion !== null
  )
    return false
  const operation = await tx.mfaOperation.findUnique({ where: { id: flow.transferId } })
  if (!operation || operation.kind !== 'setup_transfer') return false
  const parsed = setupTransferSchema.safeParse(operation.result)
  if (!parsed.success) return false
  const t = parsed.data
  if (
    operation.flowId !== t.predecessorFlowId ||
    t.successorFlowId !== flow.id ||
    t.userId !== flow.userId ||
    t.securityVersion !== flow.securityVersion ||
    t.securityVersion !== t.previousSecurityVersion + 1 ||
    new Date(t.expiresAt).getTime() !== flow.expiresAt.getTime() ||
    (phase === 'flow' && flow.expiresAt <= now)
  )
    return false
  const [account, factor, predecessor] = await Promise.all([
    tx.mfaAccount.findUnique({ where: { userId: flow.userId } }),
    tx.mfaFactor.findUnique({ where: { userId: flow.userId } }),
    tx.mfaFlow.findUnique({ where: { id: t.predecessorFlowId } }),
  ])
  const setup = readSetupState(flow.data)
  if (
    !setup ||
    !account ||
    (phase === 'flow' && setup.generation !== account.codeGeneration) ||
    account.codeGeneration < t.generation ||
    !factor ||
    !predecessor ||
    account.securityVersion !== t.securityVersion ||
    account.emergencyRequired ||
    !account.required ||
    factor.id !== t.factorId ||
    factor.version !== t.factorVersion ||
    predecessor.userId !== flow.userId ||
    predecessor.securityVersion !== t.previousSecurityVersion ||
    predecessor.state !== 'retired' ||
    predecessor.sourceFamilyId !== t.predecessorFamilyId
  )
    return false
  if (t.predecessorFamilyId === null) {
    if (
      !(
        predecessor.authorityKind === 'identity' ||
        (await recoveryTicketAuthorizedPredecessor(
          tx,
          predecessor,
          new Date(t.secondFactor.verifiedAt)
        ))
      ) ||
      predecessor.purpose !== 'initial_setup' ||
      t.previousMfaProofId !== null ||
      t.factorVersion !== 1
    )
      return false
  } else if (
    predecessor.authorityKind !== 'session' ||
    predecessor.purpose !== 'replace_factor' ||
    predecessor.sourceSecurityVersion !== t.previousSecurityVersion ||
    t.previousMfaProofId === null ||
    t.factorVersion <= 1
  )
    return false
  if (!t.browser)
    return (
      context === null &&
      flow.browserContextId === null &&
      flow.publicationGeneration === null &&
      predecessor.browserContextId === null &&
      predecessor.publicationGeneration === null &&
      flow.audience === 'direct' &&
      predecessor.audience === 'direct'
    )
  return (
    context !== null &&
    flow.browserContextId === t.browser.contextId &&
    context.id === t.browser.contextId &&
    flow.publicationGeneration === t.browser.generation &&
    context.generation === t.browser.generation &&
    t.browser.generation === t.browser.previousGeneration + 1 &&
    context.bindingHash === t.browser.bindingHash &&
    context.audience === t.browser.audience &&
    predecessor.bindingHash === t.browser.bindingHash &&
    predecessor.audience === t.browser.audience &&
    predecessor.browserContextId === t.browser.contextId &&
    predecessor.publicationGeneration === t.browser.previousGeneration
  )
}
