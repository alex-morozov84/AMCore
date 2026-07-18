import { z } from 'zod'

import type { AiTool } from '../../src/infrastructure/ai/tools/ai-tool.types'

import { AiToolRiskClass } from '@/generated/prisma/client'

const parameters = z.object({}).strict()

/** Settable hook run INSIDE `demo_fence.execute` — the e2e uses it to land a human takeover mid-tool. */
let onExecute: (() => Promise<void>) | null = null
export function setDemoFenceHook(fn: (() => Promise<void>) | null): void {
  onExecute = fn
}

/**
 * TEST-ONLY SAFE tool (Track C — ADR-054, Arc F.5 e2e). Injected only via `overrideProvider(AI_TOOLS)`.
 * Its `execute` runs a test-settable hook before returning — so an e2e can deterministically land a
 * human takeover WHILE the tool is executing, proving the dispatcher's in-tx result fence leaves the
 * invocation `EXECUTING` (orphan) on a `CANCELLED`/superseded run and writes no `TOOL_INVOCATION` step.
 */
export const demoFenceTool: AiTool<z.infer<typeof parameters>> = {
  toolId: 'demo_fence',
  displayName: 'Demo fence',
  description:
    'A test-only SAFE tool that runs a hook then returns a fixed marker; takes no arguments.',
  parameters,
  riskClass: AiToolRiskClass.SAFE,
  idempotency: 'read_only',
  async execute() {
    if (onExecute) await onExecute()
    return { output: 'demo-fence-executed' }
  },
}
