import { z } from 'zod'

import type { AiTool } from '../../src/infrastructure/ai/tools/ai-tool.types'

import { AiToolRiskClass } from '@/generated/prisma/client'

const parameters = z.object({}).strict()

/**
 * TEST-ONLY approval-gated tool (Track C — ADR-054, Arc E.5b-3 e2e). It is **never** in the production
 * `AI_TOOLS` set — it is injected only via an e2e `overrideProvider(AI_TOOLS)`, so the approval
 * lifecycle can be exercised end-to-end without shipping a SENSITIVE tool. `SENSITIVE` ⇒ the loop parks
 * it behind a human approval; `idempotent` ⇒ the registry accepts it (a non-retry-safe tool is refused).
 */
export const demoSensitiveTool: AiTool<z.infer<typeof parameters>> = {
  toolId: 'demo_sensitive',
  displayName: 'Demo sensitive',
  description: 'A test-only approval-gated tool. Returns a fixed marker; takes no arguments.',
  parameters,
  riskClass: AiToolRiskClass.SENSITIVE,
  idempotency: 'idempotent',
  execute() {
    return Promise.resolve({ output: 'demo-sensitive-executed' })
  },
}
