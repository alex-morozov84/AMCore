import { Injectable } from '@nestjs/common'

import { approvedToolCallId } from '../tools/ai-tool.constants'
import { AiToolRegistry } from '../tools/ai-tool-registry.service'

import { AiRunTerminalReason } from './ai-run.constants'
import { findUnresolvedAction } from './ai-run-loop-reconstruct'
import { AiRunTransitions } from './ai-run-transitions.service'
import { AiToolActionService, type ToolRunContext } from './ai-tool-action.service'

import { AiToolInvocationStatus } from '@/generated/prisma/client'
import { PrismaService } from '@/prisma'

/**
 * Resolves a run's unfinished tool action at the start of every epoch — BEFORE the model is asked again
 * (Track C — ADR-054, E12). The model is never re-asked while an action is pending, so a requested action
 * can never be replaced by a fresh one with a fresh idempotency key.
 *
 * | durable state                          | recovery                                                    |
 * | -------------------------------------- | ----------------------------------------------------------- |
 * | none / applied                         | proceed (normal loop)                                       |
 * | `REQUESTED` / `APPROVED`               | start it (it never ran)                                     |
 * | `EXECUTING`, older epoch, read-only    | adopt and re-run (safe repeat)                              |
 * | `EXECUTING`, older epoch, side-effect  | `OUTCOME_UNKNOWN`, run fails uncertain, nothing re-executed |
 * | `EXECUTING`, same epoch                | exit (a competing continuation owns it)                     |
 * | `OUTCOME_UNKNOWN`                      | run fails uncertain                                         |
 * | `FAILED`                               | apply the terminal policy of the persisted code             |
 * | `REJECTED`, unapplied                  | apply the rejection once, then proceed                      |
 * | `SUCCEEDED`, unapplied                 | inconsistent: fail closed                                   |
 */
@Injectable()
export class AiToolRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AiToolRegistry,
    private readonly actions: AiToolActionService,
    private readonly transitions: AiRunTransitions
  ) {}

  /** `proceed` = nothing pending (or it was applied cleanly); `done` = the run was terminalized / must exit. */
  async recover(ctx: ToolRunContext): Promise<'proceed' | 'done'> {
    const { claim } = ctx
    const action = await findUnresolvedAction(this.prisma, claim.id)
    if (action === null) return 'proceed'

    switch (action.status) {
      case AiToolInvocationStatus.OUTCOME_UNKNOWN:
        await this.transitions.failed(
          claim,
          'tool_loop_failed',
          AiRunTerminalReason.TOOL_EFFECT_UNKNOWN
        )
        return 'done'
      case AiToolInvocationStatus.FAILED:
        await this.transitions.failed(
          claim,
          'tool_loop_failed',
          action.errorCode === 'tool_schema_incompatible'
            ? AiRunTerminalReason.TOOL_SCHEMA_INCOMPATIBLE
            : AiRunTerminalReason.TOOL_EXECUTION_FAILED
        )
        return 'done'
      case AiToolInvocationStatus.SUCCEEDED:
        await this.transitions.failed(
          claim,
          'tool_loop_failed',
          AiRunTerminalReason.TOOL_STATE_INCONSISTENT
        )
        return 'done'
      case AiToolInvocationStatus.REJECTED:
        return (await this.actions.applyRejected(ctx, action)).status === 'succeeded'
          ? 'proceed'
          : 'done'
      default:
        return this.resume(ctx, action)
    }
  }

  /** Start/adopt a `REQUESTED`/`APPROVED`/`EXECUTING` action through the one-shot start CAS. */
  private async resume(
    ctx: ToolRunContext,
    action: NonNullable<Awaited<ReturnType<typeof findUnresolvedAction>>>
  ): Promise<'proceed' | 'done'> {
    const tool = this.registry.get(action.toolId)
    if (tool === undefined) {
      await this.transitions.failed(
        ctx.claim,
        'tool_loop_failed',
        AiRunTerminalReason.TOOL_NOT_ALLOWED
      )
      return 'done'
    }
    // An approval authorizes only the exact risk the owner saw: a tool whose risk changed across a deploy
    // is not run under the old approval.
    if (tool.riskClass !== action.riskClass) {
      await this.transitions.failed(
        ctx.claim,
        'tool_loop_failed',
        AiRunTerminalReason.TOOL_NOT_ALLOWED
      )
      return 'done'
    }
    const step = await this.actions.execute(ctx, action, tool, approvedToolCallId(action.id))
    return step.status === 'succeeded' ? 'proceed' : 'done'
  }
}
