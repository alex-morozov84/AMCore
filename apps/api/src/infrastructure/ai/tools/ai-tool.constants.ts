import { AiToolRiskClass } from '@prisma/client'

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
 * Code-owned risk → approval policy (Arc E). Only SAFE tools run without a human-in-the-loop
 * approval; SENSITIVE and DESTRUCTIVE tools always require one. The policy is code-owned, never
 * model- or catalog-supplied, so a hostile catalog/model cannot downgrade a tool's risk.
 */
export function toolRequiresApproval(riskClass: AiToolRiskClass): boolean {
  return riskClass !== AiToolRiskClass.SAFE
}
