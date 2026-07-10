import { Inject, Injectable } from '@nestjs/common'

import {
  AI_TOOL_ID_MAX_LENGTH,
  AI_TOOL_ID_PATTERN,
  AI_TOOL_REGISTRY_MAX_SIZE,
  toolRequiresApproval,
} from './ai-tool.constants'
import { AI_TOOLS, type AiTool, type AiToolDescriptor } from './ai-tool.types'

/**
 * Code-owned tool registry (Track C — ADR-054, Arc E, worker role only). It validates the registered
 * tool set at construction (fail-fast, fail-closed) and serves it to the bounded agent loop:
 * least-privilege allowlist filtering, provider-facing descriptors, and the code-owned risk→approval
 * policy. A model can only ever reach a tool that is BOTH registered here AND on the conversation's
 * allowlist — it cannot invent a tool or escape the code-owned set.
 */
@Injectable()
export class AiToolRegistry {
  private readonly tools: ReadonlyMap<string, AiTool>

  constructor(@Inject(AI_TOOLS) tools: AiTool[]) {
    this.tools = AiToolRegistry.validate(tools)
  }

  /** Every registered tool id (code-owned, bounded). */
  ids(): string[] {
    return [...this.tools.keys()]
  }

  /** A registered tool by id, or `undefined` — the model never reaches an unregistered tool. */
  get(toolId: string): AiTool | undefined {
    return this.tools.get(toolId)
  }

  /**
   * The registered tools a conversation may use, in registration order. Least privilege: an **empty
   * allowlist yields NO tools** (the loop degenerates to the Arc C single-call behavior), and an
   * allowlist entry with no matching registered tool is ignored — never an error, never invented.
   */
  resolveAllowed(allowlist: readonly string[]): AiTool[] {
    const allowed = new Set(allowlist)
    return [...this.tools.values()].filter((tool) => allowed.has(tool.toolId))
  }

  /** Provider-facing descriptors for the allowed tools (Arc E.3 maps these to a provider schema). */
  describeAllowed(allowlist: readonly string[]): AiToolDescriptor[] {
    return this.resolveAllowed(allowlist).map((tool) => ({
      toolId: tool.toolId,
      displayName: tool.displayName,
      description: tool.description,
      riskClass: tool.riskClass,
      parameters: tool.parameters,
    }))
  }

  /** Whether invoking a tool requires a human approval (code-owned risk policy). */
  requiresApproval(tool: AiTool): boolean {
    return toolRequiresApproval(tool.riskClass)
  }

  /**
   * Validate the code-owned tool set at startup — fail closed so a mis-declared tool can never be
   * dispatched. Enforces id grammar + length, uniqueness, the registry size cap, and the crash-retry
   * invariant (Arc E §7): an `unsafe` (non-retry-safe) tool is refused registration outright.
   */
  private static validate(tools: AiTool[]): ReadonlyMap<string, AiTool> {
    if (tools.length > AI_TOOL_REGISTRY_MAX_SIZE) {
      throw new Error(
        `AiToolRegistry: too many tools (${tools.length} > ${AI_TOOL_REGISTRY_MAX_SIZE})`
      )
    }
    const map = new Map<string, AiTool>()
    for (const tool of tools) {
      assertValidToolId(tool.toolId)
      assertRetrySafe(tool)
      if (map.has(tool.toolId)) {
        throw new Error(`AiToolRegistry: duplicate tool id "${tool.toolId}"`)
      }
      map.set(tool.toolId, tool)
    }
    return map
  }
}

function assertValidToolId(toolId: string): void {
  if (toolId.length > AI_TOOL_ID_MAX_LENGTH || !AI_TOOL_ID_PATTERN.test(toolId)) {
    throw new Error(`AiToolRegistry: invalid tool id "${toolId}"`)
  }
}

/** A tool must declare a retry-safe idempotency posture; `unsafe` is disallowed by policy (§7). */
function assertRetrySafe(tool: AiTool): void {
  if (tool.idempotency === 'unsafe') {
    throw new Error(
      `AiToolRegistry: tool "${tool.toolId}" declares idempotency "unsafe"; non-retry-safe tools are disallowed until a product design accepts the residual at-least-once risk (Arc E §7)`
    )
  }
}
