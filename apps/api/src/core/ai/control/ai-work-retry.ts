import { Injectable } from '@nestjs/common'

import { aiMessageContentSchema, aiModelSelectionSchema, type WorkReason } from '@amcore/shared'

import { aiRunInputFingerprint } from '../runs/ai-run-input-fingerprint'

import { aiRunBasicCapability } from './ai-work-policy'

import { EnvService } from '@/env/env.service'
import { AiAuthorType, AiMessageRole, type AiRun, AiRunStepType, Prisma } from '@/generated/prisma/client'
import {
  aiExecutionDescriptorSchema,
  freezeAiModel,
} from '@/infrastructure/ai/registry/ai-execution-descriptor'
import { AiModelRegistry } from '@/infrastructure/ai/registry/ai-model-registry.service'

interface PreparedRetry {
  availableAt: Date
  deadlineAt: Date
}
type RetryCheck =
  { prepared: PreparedRetry; reason?: never } | { reason: WorkReason; prepared?: never }
const transient = new Set(['provider_timeout', 'provider_unavailable'])

@Injectable()
export class AiWorkRetry {
  constructor(
    private readonly models: AiModelRegistry,
    private readonly env: EnvService
  ) {}

  async check(tx: Prisma.TransactionClient, run: AiRun, now: Date): Promise<RetryCheck> {
    const basic = aiRunBasicCapability(run, 'retry', now)
    if (basic) return { reason: basic }
    if (await tx.aiRun.count({ where: { retryOfRunId: run.id } }))
      return { reason: 'MANUAL_GRANT_SPENT' }
    const attempts = await tx.aiRunAttempt.findMany({
      where: { runId: run.id },
      orderBy: { epoch: 'asc' },
      take: 129,
    })
    if (
      !attempts.length ||
      attempts.length !== run.leaseEpoch ||
      attempts.length > 128 ||
      run.attemptCount + 1 !== run.maxAttempts ||
      run.errorCode !== attempts.at(-1)?.errorCode ||
      attempts.some(
        (attempt, index) =>
          attempt.epoch !== index + 1 ||
          !attempt.endedAt ||
          !transient.has(attempt.errorCode ?? '') ||
          attempt.outcome !== (index === attempts.length - 1 ? 'FAILED' : 'RETRY_SCHEDULED')
      )
    )
      return { reason: 'INCONSISTENT_STATE' }
    const [tools, approvals, steps, finalizations, output] = await Promise.all([
      tx.aiToolInvocation.count({ where: { runId: run.id } }),
      tx.aiApproval.count({ where: { runId: run.id } }),
      tx.aiRunStep.count({
        where: {
          runId: run.id,
          type: {
            notIn: [
              AiRunStepType.PROVIDER_CALL,
              AiRunStepType.GUARDRAIL_CHECK,
              AiRunStepType.FINALIZATION,
            ],
          },
        },
      }),
      tx.aiRunStep.findMany({
        where: { runId: run.id, type: AiRunStepType.FINALIZATION },
        select: { detail: true },
        take: 129,
      }),
      tx.aiMessage.count({ where: { runId: run.id, role: AiMessageRole.ASSISTANT } }),
    ])
    if (
      tools ||
      approvals ||
      steps ||
      output ||
      finalizations.length > 128 ||
      finalizations.some(
        (step) =>
          !step.detail ||
          typeof step.detail !== 'object' ||
          Array.isArray(step.detail) ||
          step.detail.kind !== 'provider_retry_restriction'
      )
    )
      return { reason: 'EFFECT_UNKNOWN' }
    const input = await tx.aiMessage.findUnique({ where: { id: run.inputMessageId! } })
    if (
      !input ||
      input.runId !== run.id ||
      input.archivedRunId !== null ||
      input.conversationId !== run.conversationId ||
      input.role !== AiMessageRole.USER ||
      input.authorType !== AiAuthorType.USER
    )
      return { reason: 'INCONSISTENT_STATE' }
    const parts = aiMessageContentSchema.safeParse(input.content)
    if (!parts.success || aiRunInputFingerprint(parts.data) !== run.inputFingerprint)
      return { reason: 'INCONSISTENT_STATE' }
    if (parts.data.some((part) => part.type === 'artifact_ref'))
      return { reason: 'CONTENT_UNSUPPORTED' }
    const conversation = await tx.aiConversation.findUnique({
      where: { id: run.conversationId },
      select: {
        ownerUserId: true,
        assistantId: true,
        controlledBy: true,
        state: true,
        ownershipGeneration: true,
      },
    })
    if (
      !conversation ||
      conversation.ownerUserId !== input.authorUserId ||
      conversation.controlledBy !== 'BOT' ||
      conversation.state !== 'ACTIVE' ||
      conversation.ownershipGeneration !== run.ownershipGeneration
    )
      return { reason: 'FENCE_STALE' }
    if (!run.assistantBindingCaptured || conversation.assistantId !== run.assistantIdAtCreation)
      return { reason: 'PROVIDER_CHANGED' }
    const frozen = aiExecutionDescriptorSchema.safeParse(run.modelSnapshot)
    if (!frozen.success) return { reason: 'CONTENT_UNSUPPORTED' }
    if (conversation.assistantId) {
      const assistant = await tx.aiAssistant.findUnique({
        where: { id: conversation.assistantId },
        select: { enabled: true, modelSelection: true },
      })
      if (!assistant?.enabled) return { reason: 'PROVIDER_CHANGED' }
      const selection = aiModelSelectionSchema.safeParse(assistant.modelSelection)
      if (!selection.success) return { reason: 'PROVIDER_CHANGED' }
      let selectedId: string | null = null
      for (const slug of [selection.data.modelSlug, ...selection.data.fallback]) {
        const candidate = await this.models.resolveModelInTransaction(tx, slug)
        if (candidate && this.models.hasCredential(candidate)) {
          selectedId = candidate.id
          break
        }
      }
      if (selectedId !== frozen.data.modelId) return { reason: 'PROVIDER_CHANGED' }
    }
    const live = await this.models.resolveLiveModelInTransaction(tx, frozen.data.modelId)
    if (
      !live ||
      !this.models.hasCredential(live) ||
      JSON.stringify(freezeAiModel(live)) !== JSON.stringify(frozen.data)
    )
      return { reason: 'PROVIDER_CHANGED' }
    const [restriction] = await tx.$queryRaw<
      {
        classification: string
        not_before: Date | null
      }[]
    >(Prisma.sql`SELECT classification, not_before
      FROM ai.classify_provider_retry_restriction(${run.providerRetryRestriction}, ${now})`)
    if (!restriction || ['invalid', 'unknown'].includes(restriction.classification))
      return { reason: 'METADATA_UNAVAILABLE' }
    const deadlineAt = new Date(now.getTime() + this.env.get('AI_RUN_DEADLINE_MS'))
    const availableAt =
      restriction.not_before && restriction.not_before > now ? restriction.not_before : now
    if (availableAt >= deadlineAt) return { reason: 'HORIZON_EXPIRED' }
    return { prepared: { availableAt, deadlineAt } }
  }

  async createChild(
    tx: Prisma.TransactionClient,
    source: AiRun,
    prepared: PreparedRetry
  ): Promise<string> {
    const child = await tx.aiRun.create({
      data: {
        conversationId: source.conversationId,
        retryOfRunId: source.id,
        inputMessageId: source.inputMessageId,
        inputFingerprint: source.inputFingerprint,
        assistantBindingCaptured: true,
        assistantIdAtCreation: source.assistantIdAtCreation,
        ownershipGeneration: source.ownershipGeneration,
        modelSnapshot: source.modelSnapshot as Prisma.InputJsonValue,
        ...(source.budgetSnapshot !== null
          ? { budgetSnapshot: source.budgetSnapshot as Prisma.InputJsonValue }
          : {}),
        ...(source.providerRetryRestriction !== null
          ? { providerRetryRestriction: source.providerRetryRestriction as Prisma.InputJsonValue }
          : {}),
        availableAt: prepared.availableAt,
        deadlineAt: prepared.deadlineAt,
        maxAttempts: 1,
      },
    })
    return child.id
  }
}
