import {
  AiApprovalState,
  AiRunStatus,
  AiToolInvocationStatus,
  AuditActorType,
  AuditTargetType,
  type Prisma,
} from '@prisma/client'

import {
  AI_RUN_APPROVAL_EXPIRED,
  AI_RUN_DEADLINE_EXCEEDED,
  AI_RUN_TOOL_LOOP_FAILED,
} from '../ai-run.constants'

import type { AuditLogService } from '@/core/audit'

/**
 * Thrown when any CAS in `expireApproval` matches ≠1 row (the parked-gate invariant raced away). It
 * forces the caller's `$transaction` to roll back — no partial approval/run/invocation mutation, no
 * expiry audit. The web decision path maps it to a 409; the worker sweep skips the row and logs.
 */
export class ApprovalRaceError extends Error {}

/** What is being expired: the run's own deadline passed, or only the approval TTL elapsed first. */
export interface ExpireApprovalParams {
  approvalId: string
  runId: string
  /** Run deadline reached (→ run `EXPIRED`/invocation `SKIPPED`) vs approval TTL only (→ `FAILED`/`REJECTED`). */
  deadlinePassed: boolean
  now: Date
}

/**
 * Terminalize a stale PENDING approval's parked run and void its gate, in ONE caller-supplied
 * transaction (Track C — ADR-054, Arc E.5) — the **single** source of the expiry state machine, shared
 * by the web decision freshness-gate (E.5b-1) and the worker expiry cron (E.5b-2) so the two never
 * drift. Deadline passed ⇒ run `EXPIRED` (`deadline_exceeded`) + invocation `SKIPPED`; only the approval
 * TTL elapsed ⇒ run `FAILED` (`approval_expired`) + invocation `REJECTED`. Every CAS is count-enforced
 * (all-or-nothing); the mandatory content-free `ai.approval.expired` audit is written **last**, in the
 * same tx, so a rolled-back expiry commits nothing.
 */
export async function expireApproval(
  tx: Prisma.TransactionClient,
  audit: AuditLogService,
  params: ExpireApprovalParams
): Promise<void> {
  const { approvalId, runId, deadlinePassed, now } = params
  const approval = await tx.aiApproval.updateMany({
    where: { id: approvalId, state: AiApprovalState.PENDING },
    data: { state: AiApprovalState.EXPIRED },
  })
  const run = await tx.aiRun.updateMany({
    where: { id: runId, status: AiRunStatus.WAITING_APPROVAL },
    data: deadlinePassed
      ? {
          status: AiRunStatus.EXPIRED,
          finishedAt: now,
          terminalReasonCode: AI_RUN_DEADLINE_EXCEEDED,
        }
      : {
          status: AiRunStatus.FAILED,
          finishedAt: now,
          errorCode: AI_RUN_TOOL_LOOP_FAILED,
          terminalReasonCode: AI_RUN_APPROVAL_EXPIRED,
        },
  })
  const invocation = await tx.aiToolInvocation.updateMany({
    where: { approvalId, status: AiToolInvocationStatus.AWAITING_APPROVAL },
    data: {
      status: deadlinePassed ? AiToolInvocationStatus.SKIPPED : AiToolInvocationStatus.REJECTED,
    },
  })
  if (approval.count !== 1 || run.count !== 1 || invocation.count !== 1) {
    throw new ApprovalRaceError()
  }
  await audit.record(
    {
      action: 'ai.approval.expired',
      actorType: AuditActorType.SYSTEM,
      targetType: AuditTargetType.AI_APPROVAL,
      targetId: approvalId,
      metadata: {
        approvalId,
        runId,
        reasonCode: deadlinePassed ? AI_RUN_DEADLINE_EXCEEDED : AI_RUN_APPROVAL_EXPIRED,
      },
    },
    { tx }
  )
}
