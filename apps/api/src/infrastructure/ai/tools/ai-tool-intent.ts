import { z } from 'zod'

import { aiApprovalPreviewSchema, SUPPORTED_LOCALES } from '@amcore/shared'

import { toolRequiresApproval } from './ai-tool.constants'
import type { AiTool, AiToolContext, AiToolIntent } from './ai-tool.types'
import type { AiToolContractRegistry } from './ai-tool-contract.registry'
import { boundedToolHook } from './ai-tool-hook'

import { canonicalJsonEqual, canonicalJsonHash } from '@/common/utils/canonical-json'
import { strictJson } from '@/common/utils/strict-json'
import { Prisma } from '@/generated/prisma/client'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const intentSchema = z
  .object({
    formatVersion: z.literal(1),
    toolId: z.string().min(1).max(48),
    toolVersion: z.number().int().positive(),
    inputHash: hash,
    inputSchemaHash: hash,
    normalizedSchemaHash: hash,
    runId: z.string(),
    conversationId: z.string(),
    invocationId: z.string(),
    originCall: z.number().int().positive(),
    ownerUserId: z.string().min(1),
    organizationId: z.string().nullable(),
    riskClass: z.enum(['SAFE', 'SENSITIVE', 'DESTRUCTIVE']),
    idempotency: z.enum(['read_only', 'idempotent']),
    args: z.json(),
    target: z
      .object({
        kind: z.string().min(1).max(48),
        id: z.string().min(1).max(255),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    preview: z.record(z.enum(SUPPORTED_LOCALES), aiApprovalPreviewSchema).nullable(),
  })
  .strict()

export function readToolIntent(value: unknown, expectedHash: string): AiToolIntent {
  strictJson(value, 32 * 1024)
  const intent = intentSchema.parse(value)
  if (intent.preview !== null) strictJson(intent.preview, 8 * 1024)
  if (toolRequiresApproval(intent.riskClass) && (!intent.preview || !intent.target)) {
    throw new Error('tool_approval_description_required')
  }
  if (
    intent.preview &&
    Object.values(intent.preview).some((preview) => preview.target.id !== intent.target?.id)
  ) {
    throw new Error('tool_preview_target_mismatch')
  }
  if (canonicalJsonHash(intent) !== expectedHash) throw new Error('tool_intent_hash_mismatch')
  return immutableJson(intent)
}

export function immutableJson<T>(value: T): T {
  const copy = JSON.parse(strictJson(value, 32 * 1024)) as T
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object') return
    for (const child of Object.values(item)) freeze(child)
    Object.freeze(item)
  }
  freeze(copy)
  return copy
}

/** prepare is bounded, read-only and transaction-aware; its output is never recomputed on resume. */
export async function prepareToolIntent(
  tool: AiTool,
  input: unknown,
  ctx: AiToolContext,
  tx: Prisma.TransactionClient,
  originCall: number,
  contracts: AiToolContractRegistry
): Promise<{ intent: AiToolIntent; hash: string }> {
  const entry = contracts.get(tool.toolId)
  if (!entry || entry.contract.contractVersion !== tool.contractVersion)
    throw new Error('tool_contract_incompatible')
  const inputHash = canonicalJsonHash(JSON.parse(strictJson(input, 32 * 1024)))
  const prepared = await boundedToolHook(() => tool.prepare(input, ctx, tx), ctx.signal)
  strictJson(prepared, 32 * 1024)
  const normalized = tool.normalizedSchema.parse(prepared.args)
  if (!canonicalJsonEqual(normalized, prepared.args))
    throw new Error('tool_normalized_args_changed')
  const value = {
    ...prepared,
    formatVersion: 1 as const,
    toolId: tool.toolId,
    toolVersion: tool.contractVersion,
    inputHash,
    inputSchemaHash: entry.inputSchemaHash,
    normalizedSchemaHash: entry.normalizedSchemaHash,
    runId: ctx.runId,
    conversationId: ctx.conversationId,
    invocationId: ctx.invocationId,
    originCall,
    ownerUserId: ctx.ownerUserId,
    organizationId: ctx.organizationId,
    riskClass: tool.riskClass,
    idempotency: tool.idempotency,
  }
  const intentHash = canonicalJsonHash(value)
  const intent = readToolIntent(value, intentHash)
  if (!contracts.compatible(intent)) throw new Error('tool_contract_incompatible')
  await boundedToolHook(() => entry.authority.authorize(tx, intent, 'prepare'), ctx.signal)
  if (ctx.signal?.aborted) throw new Error('tool_preparation_aborted')
  return { intent, hash: intentHash }
}

export function toolIntentData(prepared: { intent: AiToolIntent; hash: string }): {
  id: string
  intentSnapshot: Prisma.InputJsonValue
  intentHash: string
  toolVersion: number
  inputSchemaHash: string
  normalizedSchemaHash: string
  argsSnapshot: Prisma.InputJsonValue
} {
  return {
    id: prepared.intent.invocationId,
    intentSnapshot: prepared.intent as unknown as Prisma.InputJsonValue,
    intentHash: prepared.hash,
    toolVersion: prepared.intent.toolVersion,
    inputSchemaHash: prepared.intent.inputSchemaHash,
    normalizedSchemaHash: prepared.intent.normalizedSchemaHash,
    argsSnapshot: prepared.intent.args as Prisma.InputJsonValue,
  }
}
