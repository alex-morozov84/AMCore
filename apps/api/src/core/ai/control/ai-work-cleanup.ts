import { Injectable } from '@nestjs/common'

import { aiMessageContentSchema, type WorkReason } from '@amcore/shared'

import { AiAuthorType, AiMessageRole, type AiRun, Prisma } from '../../../generated/prisma/client.js'
import { aiRunInputFingerprint } from '../runs/ai-run-input-fingerprint.js'

import { aiRunBasicCapability } from './ai-work-policy.js'

@Injectable()
export class AiWorkCleanup {
  async check(
    tx: Prisma.TransactionClient,
    run: AiRun,
    now: Date,
    commandId?: string
  ): Promise<WorkReason | null> {
    const basic = aiRunBasicCapability(run, 'cleanup', now)
    if (basic) return basic
    if (!run.inputMessageId || !run.inputFingerprint || run.leaseToken || run.leaseExpiresAt)
      return 'RELATED_JOB'
    const [attempts, steps, tools, approvals, artifacts, usage, children, messages, pending] =
      await Promise.all([
        tx.aiRunAttempt.count({ where: { runId: run.id } }),
        tx.aiRunStep.count({ where: { runId: run.id } }),
        tx.aiToolInvocation.count({ where: { runId: run.id } }),
        tx.aiApproval.count({ where: { runId: run.id } }),
        tx.aiArtifact.count({ where: { runId: run.id } }),
        tx.aiUsageLedger.count({ where: { runId: run.id } }),
        tx.aiRun.count({ where: { retryOfRunId: run.id } }),
        tx.aiMessage.findMany({ where: { runId: run.id }, take: 2 }),
        tx.backgroundCommandTarget.count({
          where: {
            workId: 'ai-run-executions',
            targetId: run.id,
            state: { in: ['prepared', 'dispatching', 'unknown'] },
            ...(commandId ? { commandId: { not: commandId } } : {}),
          },
        }),
      ])
    if (
      attempts ||
      steps ||
      tools ||
      approvals ||
      artifacts ||
      usage ||
      children ||
      pending ||
      messages.length !== 1
    )
      return 'RELATED_JOB'
    const input = messages[0]!
    const conversation = await tx.aiConversation.findUnique({
      where: { id: run.conversationId },
      select: { ownerUserId: true },
    })
    if (
      input.id !== run.inputMessageId ||
      input.archivedRunId !== null ||
      input.role !== AiMessageRole.USER ||
      input.authorType !== AiAuthorType.USER ||
      !conversation ||
      input.authorUserId !== conversation.ownerUserId ||
      input.conversationId !== run.conversationId
    )
      return 'INCONSISTENT_STATE'
    const parts = aiMessageContentSchema.safeParse(input.content)
    if (!parts.success || aiRunInputFingerprint(parts.data) !== run.inputFingerprint)
      return 'INCONSISTENT_STATE'
    return null
  }

  async remove(
    tx: Prisma.TransactionClient,
    run: AiRun,
    actorId: string,
    commandId: string,
    now: Date
  ): Promise<void> {
    await tx.aiRunTombstone.create({
      data: {
        id: run.id,
        conversationId: run.conversationId,
        inputMessageId: run.inputMessageId!,
        inputFingerprint: run.inputFingerprint!,
        idempotencyKey: run.idempotencyKey,
        terminalStatus: run.status,
        terminalReasonCode: run.terminalReasonCode,
        finishedAt: run.finishedAt!,
        archivedAt: now,
        cleanupActorId: actorId,
        cleanupCommandId: commandId,
      },
    })
    await tx.aiMessage.update({
      where: { id: run.inputMessageId! },
      data: { archivedRunId: run.id },
    })
    await tx.aiRun.delete({ where: { id: run.id } })
  }
}
