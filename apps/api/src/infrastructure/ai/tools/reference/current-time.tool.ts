import { AiToolRiskClass } from '@prisma/client'
import { z } from 'zod'

import type { AiTool } from '../ai-tool.types'

/**
 * SAFE reference tool (Track C — ADR-054, Arc E) — the documented pattern for a code-owned tool.
 * It returns the current UTC time as an ISO-8601 string, has no external side effect (`read_only`),
 * touches no privileged resource, and takes no arguments. It is deliberately **not** on any enabled
 * assistant's allowlist by default — a fresh starter is never autonomously tool-capable merely
 * because Arc E shipped (Arc E §4); this exists as a pattern and for tests.
 */
const parameters = z.object({}).strict()

export const currentTimeTool: AiTool<z.infer<typeof parameters>> = {
  toolId: 'current_time',
  displayName: 'Current time',
  description:
    'Returns the current date and time in UTC as an ISO-8601 string. Takes no arguments. Use it when the user asks what the current time or date is.',
  parameters,
  riskClass: AiToolRiskClass.SAFE,
  idempotency: 'read_only',
  execute() {
    return Promise.resolve({ output: new Date().toISOString() })
  },
}
