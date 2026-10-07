import { z } from 'zod'

import type {
  AiAdapterCall,
  AiTextResult,
} from '../../src/infrastructure/ai/gateway/ai-gateway.types'
import { MockAiAdapter } from '../../src/infrastructure/ai/gateway/providers/mock.adapter'
import type { AiTool, AiToolContext } from '../../src/infrastructure/ai/tools/ai-tool.types'

import { AiToolRiskClass } from '@/generated/prisma/client'

/**
 * TEST-ONLY controls for the AI run ownership/E12 e2e suites. They never exist in production DI: the suites
 * inject {@link ControllableAdapter} and the two fixture tools via `overrideProvider(...)`.
 *
 * - `providerHook` / `beforeEffect` / `afterEffect` are barriers a test installs to pause or fail a provider
 *   call or a tool at an exact point (no real minutes are waited).
 * - `effects` is the EXTERNAL effect ledger: one entry per physical effect the tool produced, keyed by the
 *   idempotency key it received — the number the E12 assertions count.
 */
export const controls = {
  providerHook: undefined as ((call: AiAdapterCall) => Promise<void>) | undefined,
  providerCalls: 0,
  providerInFlight: 0,
  providerMaxInFlight: 0,
  toolCalls: [] as string[],
  effects: [] as string[],
  beforeEffect: undefined as ((ctx: AiToolContext) => Promise<void>) | undefined,
  afterEffect: undefined as ((ctx: AiToolContext) => Promise<void>) | undefined,
  reset(): void {
    this.providerHook = undefined
    this.providerCalls = 0
    this.providerInFlight = 0
    this.providerMaxInFlight = 0
    this.toolCalls = []
    this.effects = []
    this.beforeEffect = undefined
    this.afterEffect = undefined
  },
}

/** The key-less mock model with an installable barrier and in-flight accounting. */
export class ControllableAdapter extends MockAiAdapter {
  override async generateText(call: AiAdapterCall): Promise<AiTextResult> {
    controls.providerCalls += 1
    controls.providerInFlight += 1
    controls.providerMaxInFlight = Math.max(controls.providerMaxInFlight, controls.providerInFlight)
    try {
      await controls.providerHook?.(call)
      return await super.generateText(call)
    } finally {
      controls.providerInFlight -= 1
    }
  }
}

const noArgs = z.object({}).strict()

/** A SAFE side-effecting tool: it records one external effect per physical execution. */
export const archiveDocumentTool: AiTool<z.infer<typeof noArgs>> = {
  toolId: 'archive_document',
  displayName: 'Archive document',
  description: 'Archives the current document (a side effect). Takes no arguments.',
  parameters: noArgs,
  riskClass: AiToolRiskClass.SAFE,
  idempotency: 'idempotent',
  async execute(_args, ctx) {
    controls.toolCalls.push(ctx.idempotencyKey)
    await controls.beforeEffect?.(ctx)
    controls.effects.push(ctx.idempotencyKey) // the external effect HAPPENS here
    await controls.afterEffect?.(ctx)
    return { output: 'archived' }
  },
}

/** A SAFE read-only tool: repeating it has no effect to be unsure about. */
export const lookupItemTool: AiTool<z.infer<typeof noArgs>> = {
  toolId: 'lookup_item',
  displayName: 'Lookup item',
  description: 'Reads an item (no side effect). Takes no arguments.',
  parameters: noArgs,
  riskClass: AiToolRiskClass.SAFE,
  idempotency: 'read_only',
  async execute(_args, ctx) {
    controls.toolCalls.push(ctx.idempotencyKey)
    await controls.beforeEffect?.(ctx)
    await controls.afterEffect?.(ctx)
    return { output: 'item-1' }
  },
}

/** Resolve once `predicate()` holds (polling), or fail after `timeoutMs` — barriers without sleeping blindly. */
export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000
): Promise<void> {
  const startedAt = Date.now()
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs)
      throw new Error('until(): condition not reached in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A promise a test settles by hand (a barrier). */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
