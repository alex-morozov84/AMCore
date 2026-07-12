import { Injectable } from '@nestjs/common'
import {
  AiArtifactKind,
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
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '../../../common/exceptions'
import {
  AI_MODEL_NOT_CONFIGURED,
  AI_RUN_DEFAULT_MAX_ATTEMPTS,
  AI_RUN_WAKE_JOB_OPTIONS,
} from '../ai-run.constants'
import {
  AI_ARTIFACT_MAX_TOTAL_RAW_BYTES_PER_MESSAGE,
  AI_ARTIFACT_REBIND_BLOCKED_STATUSES,
  capabilityForArtifactKind,
  modalityForArtifactKind,
} from '../artifacts/ai-artifact.constants'

import { toAiRunResponse } from './ai-run.mapper'

import { EnvService } from '@/env/env.service'
import { AiModelRegistry } from '@/infrastructure/ai/registry/ai-model-registry.service'
import type { ResolvedAiModel } from '@/infrastructure/ai/registry/ai-registry.types'
import { JobName, QueueName } from '@/infrastructure/queue/constants/queues.constant'
import { QueueService } from '@/infrastructure/queue/queue.service'
import { PrismaService } from '@/prisma'

/** A resolved model plus the bound assistant's modality restriction, if any (Arc G). */
interface ResolvedRunModel {
  model: ResolvedAiModel
  /** `null` when the conversation has no bound assistant — no assistant-level restriction applies. */
  allowedModalities: string[] | null
}

/** One locked `AiArtifact` row's binding-relevant fields (Arc G). */
interface ArtifactBindingRow {
  kind: string
  sizeBytes: number
  boundRunStatus: string | null
}

/** Pull every `artifact_ref` part's id out of a run's input parts, in order, no dedup needed. */
function extractArtifactIds(parts: CreateAiRunInput['inputParts']): string[] {
  return parts
    .filter((part): part is Extract<typeof part, { type: 'artifact_ref' }> => {
      return part.type === 'artifact_ref'
    })
    .map((part) => part.artifactId)
}

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
    private readonly env: EnvService,
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
    const resolved = await this.resolveModel(assistantId)
    const modelSnapshot = this.toModelSnapshot(resolved.model)

    // Validate every artifact_ref BEFORE creating anything (Arc G): existence/scope, the rebind
    // matrix, model-capability gate, and assistant-modality gate all fail fast with no run/message/
    // binding created. A text-only run (the overwhelmingly common case) skips this entirely.
    const artifactIds = extractArtifactIds(input.inputParts)
    if (artifactIds.length > 0) {
      await this.assertArtifactsBindable(tx, input.conversationId, artifactIds, resolved)
    }

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
    const message = await tx.aiMessage.create({
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

    // Bind last, in the same transaction: the earlier FOR UPDATE locks (held for the whole tx) make
    // this the only writer that can land on each artifact for this attempt.
    if (artifactIds.length > 0) {
      await tx.aiArtifact.updateMany({
        where: { id: { in: artifactIds }, conversationId: input.conversationId },
        data: { runId: run.id, messageId: message.id },
      })
    }

    return { run, created: true }
  }

  /**
   * Enforce the FINAL PLAN §7 binding rules for every referenced artifact, one locked row at a
   * time (the count is bounded by `AI_ARTIFACT_MAX_PARTS_PER_MESSAGE`, so a sequential per-id lock
   * is simpler and more testable than a single array-parameterized query, at a negligible
   * round-trip cost). A violation throws before any run/message/binding is created.
   */
  private async assertArtifactsBindable(
    tx: Prisma.TransactionClient,
    conversationId: string,
    artifactIds: string[],
    resolved: ResolvedRunModel
  ): Promise<void> {
    const maxParts = this.env.get('AI_ARTIFACT_MAX_PARTS_PER_MESSAGE')
    if (artifactIds.length > maxParts) {
      throw new BadRequestException(
        `Too many artifact references in one message (max ${maxParts}).`
      )
    }

    let totalBytes = 0
    for (const artifactId of artifactIds) {
      const row = await this.lockArtifactForBinding(tx, conversationId, artifactId)
      if (row === null) {
        throw new BadRequestException(`Unknown artifact reference: ${artifactId}`)
      }
      if (
        row.boundRunStatus !== null &&
        AI_ARTIFACT_REBIND_BLOCKED_STATUSES.has(row.boundRunStatus as AiRunStatus)
      ) {
        throw new ConflictException(`Artifact ${artifactId} is already bound to another run.`)
      }

      const kind = row.kind as AiArtifactKind
      const capability = capabilityForArtifactKind(kind)
      if (capability === null || resolved.model.capabilities[capability] !== true) {
        throw new BadRequestException(
          `The resolved model does not support artifact kind "${kind.toLowerCase()}".`
        )
      }
      const modality = modalityForArtifactKind(kind)
      if (
        resolved.allowedModalities !== null &&
        (modality === null || !resolved.allowedModalities.includes(modality))
      ) {
        throw new BadRequestException(
          `The conversation's assistant does not allow artifact kind "${kind.toLowerCase()}".`
        )
      }
      totalBytes += row.sizeBytes
    }

    if (totalBytes > AI_ARTIFACT_MAX_TOTAL_RAW_BYTES_PER_MESSAGE) {
      throw new BadRequestException(
        'Referenced artifacts exceed the total per-message size budget.'
      )
    }
  }

  /**
   * Lock one `AiArtifact` row (`FOR UPDATE OF a`) scoped to the given conversation, with its
   * currently-bound run's status (if any) via a `LEFT JOIN` — existence, conversation-scope, and
   * rebind eligibility all resolve from this single locked read. A foreign or nonexistent artifact
   * id returns `null` (no existence leak — the two cases are indistinguishable from this query).
   */
  private async lockArtifactForBinding(
    tx: Prisma.TransactionClient,
    conversationId: string,
    artifactId: string
  ): Promise<ArtifactBindingRow | null> {
    const rows = await tx.$queryRaw<ArtifactBindingRow[]>(Prisma.sql`
      SELECT a."kind"::text AS "kind",
             a."sizeBytes" AS "sizeBytes",
             r.status::text AS "boundRunStatus"
      FROM "ai"."ai_artifacts" a
      LEFT JOIN "ai"."ai_runs" r ON a."runId" = r.id
      WHERE a.id = ${artifactId} AND a."conversationId" = ${conversationId}
      FOR UPDATE OF a
    `)
    return rows[0] ?? null
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
   * Resolve the model (+ the bound assistant's modality restriction, if any). A bound assistant
   * supplies the model via its `modelSelection` (Arc F.4, credential-gated); otherwise the
   * credential-gated default, with no assistant-level modality restriction (§2 invariant 4).
   */
  private async resolveModel(assistantId: string | null): Promise<ResolvedRunModel> {
    if (assistantId !== null) return this.resolveAssistantModel(assistantId)
    const model = await this.registry.resolveDefaultModel()
    if (!model) {
      throw new ServiceUnavailableException('No AI model is configured.', AI_MODEL_NOT_CONFIGURED)
    }
    return { model, allowedModalities: null }
  }

  /** Freeze a **secret-free** snapshot of the resolved model (no credential slot, base URL, or config). */
  private toModelSnapshot(model: ResolvedAiModel): Prisma.InputJsonValue {
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
  private async resolveAssistantModel(assistantId: string): Promise<ResolvedRunModel> {
    const assistant = await this.prisma.aiAssistant.findUnique({
      where: { id: assistantId },
      select: { enabled: true, modelSelection: true, allowedModalities: true },
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
        if (model && this.registry.hasCredential(model)) {
          return { model, allowedModalities: assistant.allowedModalities }
        }
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
