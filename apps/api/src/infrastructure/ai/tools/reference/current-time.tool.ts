import type { AiTool } from '../ai-tool.types'

import { currentTimeContract } from './current-time.contract'

/**
 * SAFE reference tool (Track C — ADR-054, Arc E) — the documented pattern for a code-owned tool.
 * It returns the current UTC time as an ISO-8601 string, has no external side effect (`read_only`),
 * touches no privileged resource, and takes no arguments. It is deliberately **not** on any enabled
 * assistant's allowlist by default — a fresh starter is never autonomously tool-capable merely
 * because Arc E shipped (Arc E §4); this exists as a pattern and for tests.
 */
export const currentTimeTool: AiTool<Record<string, never>> = {
  ...currentTimeContract,
  async prepare(input) {
    return { args: input, target: null, preview: null }
  },
  execute() {
    return Promise.resolve({ output: new Date().toISOString() })
  },
}
