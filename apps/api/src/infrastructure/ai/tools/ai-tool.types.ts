import type { DynamicModule, InjectionToken, Type } from '@nestjs/common'
import type { ZodType } from 'zod'

import type { AiApprovalPreview, SupportedLocale } from '@amcore/shared'

import type { Prisma } from '@/generated/prisma/client'
import type { AiToolRiskClass } from '@/generated/prisma/client'

/**
 * Self-hosted tool contract (Track C — ADR-054, Arc E, worker role only). A tool is code-owned: the
 * model may only invoke a tool the host registered (it cannot invent one), its `parameters` are
 * validated before `execute`, and its `riskClass` drives the human-approval requirement. Execution
 * happens host-side in the worker after an `AiToolInvocation` is persisted — never via SDK
 * auto-execution (Arc E invariant 1). No secret ever rides these types.
 */

/** DI token for the code-owned list of tools the registry validates at startup and serves. */
export const AI_TOOLS = 'AI_TOOLS'

/**
 * A tool's crash-retry posture — declared by the author, enforced by the registry (Arc E §7).
 * `read_only` has no external side effect (safe to re-run); `idempotent` has a side effect but is
 * retry-safe when handed `ctx.idempotencyKey`; `unsafe` is not retry-safe and is refused
 * registration outright until a product design accepts the residual at-least-once risk.
 */
export type AiToolIdempotency = 'read_only' | 'idempotent' | 'unsafe'

/**
 * Execution context handed to a tool (worker-side, under the run owner's identity). It carries only
 * validated args + durable run identifiers — no prompt, model output, or credential. Tools enforce
 * their own RBAC over whatever they touch (documented contract); the reference tool touches nothing
 * privileged.
 */
export interface AiToolContext {
  runId: string
  conversationId: string
  ownerUserId: string
  organizationId: string | null
  invocationId: string
  /**
   * Stable idempotency key a side-effecting tool passes downstream so a crash-retry (at-least-once)
   * does not double-apply: `ai-tool:<invocationId>` (Arc E §7). Constant across resume attempts.
   */
  idempotencyKey: string
  /** Aborts when the per-tool execution timeout elapses (Arc E.4 wires the bound). */
  signal?: AbortSignal
}

/**
 * The bounded, text-only result of a tool execution. `output` re-enters the model as **untrusted**
 * data through the Arc D trust boundary (indirect-injection containment) — never the instruction
 * channel. Structured/multimodal tool results are deferred to Arc G.
 */
export interface AiToolResult {
  output: string
}

/** A code-owned tool definition. `TParams` is inferred from `parameters`. */
export interface AiToolContract<TInput = unknown, TArgs = TInput> {
  readonly contractVersion: number
  readonly normalizedSchema: ZodType<TArgs>
  readonly authority: { module: Type<unknown>; token: InjectionToken }
  readonly toolId: string
  readonly displayName: string
  /** Provider-facing description — what the tool does and when to use it. No secrets. */
  readonly description: string
  readonly parameters: ZodType<TInput>
  readonly riskClass: AiToolRiskClass
  readonly idempotency: AiToolIdempotency
}

export interface AiToolPreparation<TParams = unknown> {
  args: TParams
  target: { kind: string; id: string; revision: number } | null
  preview: Partial<Record<SupportedLocale, AiApprovalPreview>> | null
}

export interface AiToolIntent<TParams = unknown> extends AiToolPreparation<TParams> {
  formatVersion: 1
  toolId: string
  toolVersion: number
  inputSchemaHash: string
  inputHash: string
  normalizedSchemaHash: string
  runId: string
  conversationId: string
  invocationId: string
  originCall: number
  ownerUserId: string
  organizationId: string | null
  riskClass: AiToolRiskClass
  idempotency: AiToolIdempotency
}

export interface AiTool<TInput = unknown, TArgs = TInput> extends AiToolContract<TInput, TArgs> {
  /** Resolve indirect input to the exact effect. No transport I/O or business mutation here. */
  prepare(
    input: TInput,
    ctx: AiToolContext,
    tx: Prisma.TransactionClient
  ): Promise<AiToolPreparation<TArgs>>
  execute(intent: AiToolIntent<TArgs>, ctx: AiToolContext): Promise<AiToolResult>
}

/** Headless read/execute authority; safe to instantiate in the web role. */
export interface AiToolAuthority {
  canDisclose(tx: Prisma.TransactionClient, intent: AiToolIntent): Promise<boolean>
  authorize(
    tx: Prisma.TransactionClient,
    intent: AiToolIntent,
    phase: 'prepare' | 'approve' | 'execute'
  ): Promise<void>
}

export interface AiToolRegistration {
  contract: AiToolContract
  worker: (core: Type<unknown>) => DynamicModule
  executorToken: InjectionToken
}

/**
 * Provider-agnostic descriptor for an allowed tool. The gateway (Arc E.3) maps `parameters` to a
 * provider tool schema; risk/id stay host-side. Carries no `execute` — descriptors are inert data.
 */
export interface AiToolDescriptor {
  toolId: string
  displayName: string
  description: string
  riskClass: AiToolRiskClass
  parameters: ZodType<unknown>
}
