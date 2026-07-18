import { AiToolRiskClass } from '@/generated/prisma/client'

/**
 * Self-hosted tool registry constants + code-owned policy (Track C — ADR-054, Arc E). Starter
 * defaults are tuned by code change, not env (matching the run-dispatch convention). Worker-side only.
 */

/** Grammar for a stable tool id — one lowercase snake segment, e.g. `current_time`. */
export const AI_TOOL_ID_PATTERN = /^[a-z][a-z0-9_]*$/
export const AI_TOOL_ID_MAX_LENGTH = 48

/**
 * Defensive cap on the registered tool count. The starter registry is code-owned and small; the cap
 * keeps the provider tool-descriptor payload and the metric `tool_id` label set bounded (Arc E §8).
 * A fork registering more tools raises this deliberately in code.
 */
export const AI_TOOL_REGISTRY_MAX_SIZE = 64

/** Prefix for the per-invocation idempotency key handed to side-effecting tools (Arc E §7). */
export const AI_TOOL_IDEMPOTENCY_KEY_PREFIX = 'ai-tool:'

/** The stable idempotency key a tool passes downstream so a crash-retry does not double-apply. */
export function toolIdempotencyKey(invocationId: string): string {
  return `${AI_TOOL_IDEMPOTENCY_KEY_PREFIX}${invocationId}`
}

/**
 * Deterministic, provider-agnostic `toolCallId` that pairs the reconstructed assistant tool-call turn
 * with its tool-result turn for an approval-gated invocation (Arc E.5). The original provider call id
 * is not persisted; this synthetic id is derived from the durable `invocationId` so an uninterrupted
 * resume and a crash-resumed one build byte-identical transcripts. Used pairwise on both turns.
 */
export function approvedToolCallId(invocationId: string): string {
  return `ai-tool-inv:${invocationId}`
}

/**
 * Fixed, content-free tool-result fed back to the model when the owner REJECTED an approval-gated tool
 * call (Arc E.5). It carries no arguments or reason text — the model simply learns the call was denied
 * and answers without it. Re-entered as UNTRUSTED data under the Arc D boundary like any tool result.
 */
export const AI_TOOL_REJECTION_NOTICE =
  'This tool call was rejected by the user and was not executed. Continue and answer without it.'

/**
 * Bounded, machine-readable per-invocation error codes (`AiToolInvocation.errorCode`) — never a tool
 * payload, args, result, or free text. The loop maps these to a run terminal reason (Arc E.4).
 */
export const AiToolErrorCode = {
  /** The model requested a tool not registered or not on the conversation allowlist. */
  TOOL_NOT_ALLOWED: 'tool_not_allowed',
  /** The model's tool arguments failed the tool's Zod parameter schema. */
  TOOL_ARGS_INVALID: 'tool_args_invalid',
  /** The tool's `execute` threw or exceeded `AI_TOOL_EXECUTION_TIMEOUT_MS`. */
  TOOL_EXECUTION_FAILED: 'tool_execution_failed',
} as const
export type AiToolErrorCodeValue = (typeof AiToolErrorCode)[keyof typeof AiToolErrorCode]

/**
 * Code-owned risk → approval policy (Arc E). Only SAFE tools run without a human-in-the-loop
 * approval; SENSITIVE and DESTRUCTIVE tools always require one. The policy is code-owned, never
 * model- or catalog-supplied, so a hostile catalog/model cannot downgrade a tool's risk.
 */
export function toolRequiresApproval(riskClass: AiToolRiskClass): boolean {
  return riskClass !== AiToolRiskClass.SAFE
}
