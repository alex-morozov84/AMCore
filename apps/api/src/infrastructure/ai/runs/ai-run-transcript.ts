import type { AiGenerateMessage } from '../gateway/ai-gateway.types'
import { wrapUntrusted } from '../guardrails/trust-boundary.builder'

/**
 * One completed tool round reconstructed from a SUCCEEDED `AiToolInvocation` and its ordering
 * `TOOL_INVOCATION` step (Track C — ADR-054, Arc E). The caller supplies these already ordered by
 * `AiRunStep.stepNumber` (provable resume order — Agent 2 constraint 1), so this module stays pure.
 */
export interface CompletedToolRound {
  /** Stable pairing id linking the assistant tool-call turn to its tool-result turn. */
  toolCallId: string
  /** The code-owned tool id (the model-facing tool name). */
  toolId: string
  /** The validated arguments the tool was called with (`AiToolInvocation.argsSnapshot`). */
  input: unknown
  /** The tool's text output (`AiToolInvocation.resultSummary.output`). */
  output: string
}

/**
 * Reconstruct the model message list for the next loop step from the wrapped user turn(s) and the
 * run's completed tool rounds (Arc E). Each round becomes an `assistant` tool-call turn + a `tool`
 * result turn whose output is wrapped UNTRUSTED under `toolMarker` via the shared Arc D primitive —
 * so indirect injection through a tool result is contained by the same boundary discipline as user
 * input, never fed as trusted instructions. Pure and deterministic given its inputs.
 */
export function reconstructLoopMessages(
  userMessages: AiGenerateMessage[],
  rounds: readonly CompletedToolRound[],
  toolMarker: string
): AiGenerateMessage[] {
  const messages: AiGenerateMessage[] = [...userMessages]
  for (const round of rounds) {
    messages.push({
      role: 'assistant',
      toolCalls: [{ toolCallId: round.toolCallId, toolName: round.toolId, input: round.input }],
    })
    messages.push({
      role: 'tool',
      toolResults: [
        {
          toolCallId: round.toolCallId,
          toolName: round.toolId,
          output: wrapUntrusted(toolMarker, round.output),
        },
      ],
    })
  }
  return messages
}
