import { Injectable } from '@nestjs/common'
import {
  AiAuthorType,
  AiConversationControl,
  AiConversationState,
  AiMessageRole,
  AiRunStatus,
  Prisma,
} from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import { aiModelSelectionSchema, type AiRunResponse, type CreateAiRunInput } from '@amcore/shared'

import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '../../../common/exceptions'
import {
  AI_MODEL_NOT_CONFIGURED,
  AI_RUN_DEFAULT_MAX_ATTEMPTS,
  AI_RUN_WAKE_JOB_OPTIONS,
} from '../ai-run.constants'

import { toAiRunResponse } from './ai-run.mapper'

import { AiModelRegistry } from '@/infrastructure/ai/registry/ai-model-registry.service'
import type { ResolvedAiModel } from '@/infrastructure/ai/registry/ai-registry.types'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'
import { QueueService } from '@/infrastructure/queue/queue.service'
import { PrismaService } from '@/prisma'

/** Best-effort wake payload (ADR-052 pattern). Validated by the worker processor in Arc C.4. */
export interface AiRunWakeJob {
  runId: string
}

/**
 * Run producer (Track C — ADR-054, Arc C, web role). Queues a durable `AiRun` and persists the
 * user's input turn — **no provider I/O** (the worker executes the run in Arc C.4). In one
 * transaction it locks the owning conversation (`FOR UPDATE`, serializing concurrent appends),
 * persists the `USER` `AiMessage`, and inserts the `QUEUED` run with a frozen **secret-free**
 * model snapshot and the locked `maxAttempts` budget. Creation is idempotent on the run's own
 * `(conversationId, idempotencyKey)`; a fresh run then fires a best-effort post-commit wake.
 */
@Injectable()
export class AiRunProducerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AiModelRegistry,
    private readonly queue: QueueService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunProducerService.name)
  }

  async create(userId: string, input: CreateAiRunInput): Promise<AiRunResponse> {
    const { run, created } = await this.prisma.$transaction((tx) => this.runInTx(tx, userId, input))

    // Best-effort, post-commit: a Redis/queue outage must not fail a committed run — the worker
    // recovery cron (Arc C.4) claims the QUEUED run regardless. Never wake on an idempotent replay.
    if (created) await this.enqueueWake(run.id)
    return toAiRunResponse(run)
  }

  private async runInTx(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CreateAiRunInput
  ): Promise<{ run: Prisma.AiRunGetPayload<object>; created: boolean }> {
    const { ownershipGeneration, assistantId } = await this.lockOwnedConversation(
      tx,
      input.conversationId,
      userId
    )

    if (input.idempotencyKey) {
      const existing = await tx.aiRun.findFirst({
        where: { conversationId: input.conversationId, idempotencyKey: input.idempotencyKey },
      })
      if (existing) return { run: existing, created: false }
    }

    // Resolve the model AFTER the idempotency check (never on a replay). A bound assistant supplies the
    // model (credential-gated) + must be enabled (Arc F.4); otherwise the credential-gated default.
    const modelSnapshot = await this.resolveModelSnapshot(assistantId)

    // Create the run first so the USER turn can carry its `runId`: this binds the input turn to
    // exactly one run, so when several runs are queued on one conversation before execution the
    // C.4 worker reads a single run's own input rather than guessing by sequence. The conversation's
    // current `ownershipGeneration` is frozen onto the run (ADR-049 fence, Arc F) so a later human
    // takeover supersedes this run instead of letting it write a stale turn.
    const run = await tx.aiRun.create({
      data: {
        conversationId: input.conversationId,
        status: AiRunStatus.QUEUED,
        ownershipGeneration,
        modelSnapshot,
        idempotencyKey: input.idempotencyKey ?? null,
        maxAttempts: AI_RUN_DEFAULT_MAX_ATTEMPTS,
      },
    })
    const sequence = await this.nextSequence(tx, input.conversationId)
    await tx.aiMessage.create({
      data: {
        conversationId: input.conversationId,
        runId: run.id,
        sequence,
        role: AiMessageRole.USER,
        authorType: AiAuthorType.USER,
        authorUserId: userId,
        content: input.inputParts as unknown as Prisma.InputJsonValue,
      },
    })
    return { run, created: true }
  }

  /**
   * Lock the conversation row **filtered by owner** and assert it exists; a missing or not-owned
   * conversation returns 0 rows → 404 (no existence leak), and we never briefly lock another
   * user's row by a guessed id.
   */
  private async lockOwnedConversation(
    tx: Prisma.TransactionClient,
    conversationId: string,
    userId: string
  ): Promise<{ ownershipGeneration: number; assistantId: string | null }> {
    const rows = await tx.$queryRaw<
      {
        ownershipGeneration: number
        controlledBy: string
        state: string
        assistantId: string | null
      }[]
    >(Prisma.sql`
      SELECT "ownershipGeneration",
             "controlledBy"::text AS "controlledBy",
             state::text AS state,
             "assistantId"
      FROM "ai"."ai_conversations"
      WHERE id = ${conversationId} AND "ownerUserId" = ${userId}
      FOR UPDATE
    `)
    const row = rows[0]
    if (row === undefined) {
      throw new NotFoundException('Conversation', conversationId)
    }
    // A new bot run cannot be queued while a human holds the conversation or it is closed (ADR-049
    // fence, Arc F, invariant #6): the bot must not act under human control. 409 — the owner (or
    // operator) releases control first. The worker fence is the backstop; this is the front-door gate.
    if (
      row.controlledBy !== AiConversationControl.BOT ||
      row.state !== AiConversationState.ACTIVE
    ) {
      throw new ConflictException(
        'This conversation is under human control or closed; a new AI run cannot be started.'
      )
    }
    return { ownershipGeneration: row.ownershipGeneration, assistantId: row.assistantId ?? null }
  }

  private async nextSequence(
    tx: Prisma.TransactionClient,
    conversationId: string
  ): Promise<number> {
    const { _max } = await tx.aiMessage.aggregate({
      where: { conversationId },
      _max: { sequence: true },
    })
    return (_max.sequence ?? -1) + 1
  }

  /**
   * Freeze a **secret-free** snapshot of the resolved model (no credential slot, base URL, or provider
   * config). A bound assistant supplies the model via its `modelSelection` (Arc F.4, credential-gated);
   * otherwise the credential-gated default. The worker re-resolves the credential at execution time.
   */
  private async resolveModelSnapshot(assistantId: string | null): Promise<Prisma.InputJsonValue> {
    const model =
      assistantId !== null
        ? await this.resolveAssistantModel(assistantId)
        : await this.registry.resolveDefaultModel()
    if (!model) {
      throw new ServiceUnavailableException('No AI model is configured.', AI_MODEL_NOT_CONFIGURED)
    }
    return {
      modelSlug: model.slug,
      providerType: model.provider.type,
      providerModelName: model.providerModelName,
      capabilities: model.capabilities,
      contextLimit: model.contextLimit,
      maxOutputTokens: model.maxOutputTokens,
    }
  }

  /**
   * Resolve a bound assistant's model (Arc F.4). The assistant must be **enabled** (kill-switch — a
   * disabled assistant cannot drive a run → `409`). Its `modelSelection` (primary + ordered fallbacks)
   * is resolved **credential-gated**: the first candidate that exists, is enabled, and has a usable
   * credential wins. A pinned model with no credential does **not** silently fall back to `mock` — the
   * run is refused (`503`), so an operator's explicit model choice is never quietly downgraded in prod.
   */
  private async resolveAssistantModel(assistantId: string): Promise<ResolvedAiModel> {
    const assistant = await this.prisma.aiAssistant.findUnique({
      where: { id: assistantId },
      select: { enabled: true, modelSelection: true },
    })
    if (!assistant) throw new NotFoundException('Ai assistant', assistantId)
    if (!assistant.enabled) {
      throw new ConflictException(
        'The conversation assistant is disabled; a run cannot be started.'
      )
    }
    const selection = aiModelSelectionSchema.safeParse(assistant.modelSelection)
    if (selection.success) {
      for (const slug of [selection.data.modelSlug, ...selection.data.fallback]) {
        const model = await this.registry.resolveModel(slug)
        if (model && this.registry.hasCredential(model)) return model
      }
    }
    throw new ServiceUnavailableException(
      'The assistant model is not configured.',
      AI_MODEL_NOT_CONFIGURED
    )
  }

  /** Swallow queue/Redis errors — the recovery cron drains the QUEUED run regardless. */
  private async enqueueWake(runId: string): Promise<void> {
    try {
      await this.queue.add(
        QueueName.AI_RUNS,
        JobName.AI_RUN_WAKE,
        { runId } satisfies AiRunWakeJob,
        AI_RUN_WAKE_JOB_OPTIONS
      )
    } catch (err) {
      this.logger.warn(
        {
          event: 'ai.run.wake_enqueue_failed',
          runId,
          err: err instanceof Error ? err.message : 'unknown',
        },
        'Failed to enqueue AI run wake (recovery cron will claim it)'
      )
    }
  }
}
