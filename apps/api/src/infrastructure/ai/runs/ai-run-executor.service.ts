import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { AiRunSseReason, AiRunStatusValue } from '@amcore/shared'

import { capabilityForArtifactKind } from '../../../core/ai/artifacts/ai-artifact.constants'
import { AiRunRealtimePublisher } from '../../../core/ai/realtime/ai-run-realtime.publisher'
import type { AiGenerateMessage, AiUserContentPart } from '../gateway/ai-gateway.types'
import { scanInput } from '../guardrails/input-guard'
import {
  buildTrustBoundaryRequest,
  multimodalUntrustedPolicy,
} from '../guardrails/trust-boundary.builder'
import { aiExecutionDescriptorSchema, descriptorFailure } from '../registry/ai-execution-descriptor'

import { AiRunErrorCode, AiRunTerminalReason } from './ai-run.constants'
import type { ClaimedRun, GuardrailStepCategory } from './ai-run-dispatch.types'
import { AiRunGuard } from './ai-run-guard.service'
import { AiRunLoopExecutor } from './ai-run-loop-executor.service'
import type { RunPlan } from './ai-run-plan'
import { AI_RUN_SHUTDOWN_LATCH } from './ai-run-shutdown'
import { AiRunTransitions } from './ai-run-transitions.service'
import { AiToolActionService } from './ai-tool-action.service'

import { EnvService } from '@/env/env.service'
import { AiArtifactKind, AiMessageRole, AiRunStepType, Prisma } from '@/generated/prisma/client'
import { MetricsService } from '@/infrastructure/observability'
import { StorageObjectNotFoundError, StorageService } from '@/infrastructure/storage'
import { type AttemptRuntime, CUTOFF, type ShutdownLatch } from '@/infrastructure/worker-lifecycle'
import { PrismaService } from '@/prisma'

/** The single bounded realtime reason (Track C — ADR-054, Arc C.5); no content ever rides it. */
const RUN_STATUS_CHANGED: AiRunSseReason = 'status_changed'

/**
 * Executes one claimed AI run (Track C — ADR-054, Arc C.4/E.4b, worker role only). This is the thin
 * outer shell: it honors a cancellation/deadline observed before any provider I/O, resolves the run's
 * frozen model + own input turn, enforces the Arc D **input**-side guardrails (oversize + input guard
 * refuse before any provider call), assembles the structural trust boundary, resolves the bound
 * assistant's tool allowlist, and hands the resulting plan to the worker-only `AiRunLoopExecutor` —
 * which owns all provider I/O, the bounded SAFE tool loop, the output guard, and every terminal
 * transition. A single best-effort, content-free status hint is emitted for every path.
 */
@Injectable()
export class AiRunExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: AiRunGuard,
    private readonly transitions: AiRunTransitions,
    @Inject(AI_RUN_SHUTDOWN_LATCH) private readonly latch: ShutdownLatch,
    private readonly loop: AiRunLoopExecutor,
    private readonly publisher: AiRunRealtimePublisher,
    private readonly storage: StorageService,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    private readonly actions: AiToolActionService
  ) {
    this.logger.setContext(AiRunExecutorService.name)
  }

  /**
   * Run one attempt of a claimed run to a terminal transition (or leave it non-terminal to retry),
   * then emit a single best-effort, content-free status hint reflecting the run's committed status
   * (Arc C.5). The hint is fired in a `finally` so every path signals the client to refetch; a publish
   * never affects the durable outcome (status-only SSE is at-most-once, Postgres is recovery).
   */
  async execute(claim: ClaimedRun, runtime: AttemptRuntime): Promise<void> {
    try {
      await this.runAttempt(claim, runtime)
    } finally {
      // Fire-and-forget: the durable transition is already committed, so the worker must NOT block on
      // Redis for a best-effort hint. `publishStatusHint` is internally catch-all — it never rejects.
      void this.publishStatusHint(claim.id)
    }
  }

  private async runAttempt(claim: ClaimedRun, runtime: AttemptRuntime): Promise<void> {
    if (await this.actions.resolvePendingUnknown(claim)) return
    const plan = await this.preflight(claim)
    // A null plan means pre-flight already reached a terminal/handled state (cancel, deadline, bad
    // snapshot, missing input, guardrail refusal) — nothing more to do this attempt.
    if (plan === null) return
    await this.loop.run(claim, plan, runtime)
  }

  /**
   * Publish the run's current committed status as a content-free hint (best-effort). Reads the status
   * + owner in one query through the shutdown latch (a closed/sealed dispatcher issues no late DB
   * read); never throws and never carries a prompt/response/model slug.
   */
  private async publishStatusHint(runId: string): Promise<void> {
    try {
      if (this.latch.closed) return
      const run = await this.latch.run(() =>
        this.prisma.aiRun.findUnique({
          where: { id: runId },
          select: { status: true, conversation: { select: { ownerUserId: true } } },
        })
      )
      if (run === CUTOFF || !run) return
      await this.latch.run(() =>
        this.publisher.publish(
          run.conversation.ownerUserId,
          runId,
          run.status.toLowerCase() as AiRunStatusValue,
          RUN_STATUS_CHANGED
        )
      )
    } catch {
      // Best-effort: the client repairs a missed hint on its next reconnect/refetch.
    }
  }

  /**
   * Resolve the model, input, guardrails, and tool allowlist for the loop, or short-circuit to a
   * terminal transition. Returns `null` when the attempt is already handled (cancelled/expired/
   * permanent-failed/refused).
   */
  private async preflight(claim: ClaimedRun): Promise<RunPlan | null> {
    // Admission: lease (fresh clock), a cancel that landed after claim, a human takeover, the deadline and
    // shutdown are all evaluated together under the run guard before any pre-flight work.
    const admitted = await this.guard.admit(claim, async () => undefined)
    if (admitted.kind === 'stopped') {
      await this.transitions.stop(claim, admitted.cause)
      return null
    }
    if (admitted.kind !== 'ok') return null

    const parsed = aiExecutionDescriptorSchema.safeParse(claim.modelSnapshot)
    if (!parsed.success) {
      await this.transitions.failed(claim, descriptorFailure(claim.modelSnapshot))
      return null
    }
    const execution = parsed.data
    const modelSlug = execution.modelSlug

    // Every pre-flight read and download is its own latch-bounded operation: after the shutdown seal no
    // later query or storage fetch of this attempt starts (an outer wrapper would not stop the tail).
    const conversation = await this.latch.run(() =>
      this.prisma.aiConversation.findUnique({
        where: { id: claim.conversationId },
        select: {
          ownerUserId: true,
          assistantId: true,
          organizationId: true,
          assistant: { select: { toolAllowlist: true, systemPrompt: true, enabled: true } },
        },
      })
    )
    if (conversation === CUTOFF) return null
    // The run's OWN input turn is bound by `runId` (not the max-sequence message) so several runs
    // queued on one conversation before execution each read their own input.
    const input = await this.latch.run(() =>
      this.prisma.aiMessage.findFirst({
        where: { runId: claim.id, role: AiMessageRole.USER },
        orderBy: { sequence: 'asc' },
        select: { content: true },
      })
    )
    if (input === CUTOFF) return null
    if (conversation === null || input === null) {
      await this.transitions.failed(claim, AiRunErrorCode.INPUT_MISSING)
      return null
    }

    // The ownership fence (ADR-049, Arc F) was evaluated by the admission above and is re-checked by every
    // later admission, before each provider call and tool start — a takeover abandons the run terminally
    // with no spend and no stale bot turn written into a human conversation.

    // Enabled kill-switch (Arc F.4): a bound assistant disabled after this run was queued must not drive
    // it. Terminal `FAILED` before any provider I/O (the producer gates new runs; this catches the race).
    if (conversation.assistant && !conversation.assistant.enabled) {
      await this.transitions.failed(
        claim,
        AiRunErrorCode.ASSISTANT_DISABLED,
        AiRunTerminalReason.ASSISTANT_DISABLED
      )
      return null
    }

    // Arc G: a turn is valid with either non-empty text OR at least one artifact_ref — an
    // image-only turn with no caption is no longer a failure (the bug this arc fixes).
    const inputText = extractText(input.content)
    const artifactIds = extractArtifactIds(input.content)
    if (inputText.length === 0 && artifactIds.length === 0) {
      await this.transitions.failed(claim, AiRunErrorCode.NO_INPUT)
      return null
    }

    const inputFlagCategories = await this.runInputGuards(claim, inputText)
    if (inputFlagCategories === null) return null // oversize / block already refused

    // Resolve every referenced artifact (Arc G): the producer already gated existence/capability/
    // modality/rebind at run-creation time — this is the worker-side backstop (re-checks capability
    // against the frozen snapshot, "should never actually fire") plus the actual byte fetch, which
    // only the worker can do (never the web role). A resolution failure is terminal.
    let artifactParts: AiUserContentPart[] = []
    if (artifactIds.length > 0) {
      const resolved = await this.resolveArtifacts(claim, artifactIds)
      if (resolved === null) return null // already finalized artifact_unavailable
      artifactParts = resolved
    }

    // Arc D structural trust boundary: untrusted user text JSON-encoded in a salted container; the
    // trusted instruction goes in `system`. Arc F.4: the bound assistant's `systemPrompt` becomes that
    // trusted instruction (falling back to the code-owned default) — the code-owned structural-boundary
    // policy is ALWAYS appended by the builder, so a per-assistant prompt never weakens the boundary.
    const maxInputChars = this.env.get('AI_GUARDRAIL_MAX_INPUT_CHARS')
    const boundary = buildTrustBoundaryRequest({
      untrustedUserText: inputText,
      maxInputChars,
      systemInstruction: conversation.assistant?.systemPrompt ?? undefined,
    })
    // Artifact parts ride as sibling entries in the SAME untrusted user turn as the wrapped text —
    // never `system`. `wrapUntrusted` only ever wraps the text payload; binary parts are appended
    // alongside it, not embedded inside the escaped text blob. When artifacts are present the system
    // instruction also gains the multimodal untrusted-data policy (defense in depth) — binary parts
    // cannot be marker-wrapped, so this tells the model that image/PDF content is data, not commands.
    const hasArtifacts = artifactParts.length > 0
    const system = hasArtifacts
      ? `${boundary.system}\n\n${multimodalUntrustedPolicy()}`
      : boundary.system
    const userMessages: AiGenerateMessage[] = hasArtifacts
      ? [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: boundary.messages[0]!.content },
              ...artifactParts,
            ],
          },
        ]
      : boundary.messages
    return {
      modelSlug,
      execution,
      assistantId: conversation.assistantId,
      system,
      userMessages,
      marker: boundary.marker,
      toolAllowlist: conversation.assistant?.toolAllowlist ?? [],
      inputFlagCategories,
      attribution: {
        userId: conversation.ownerUserId,
        organizationId: conversation.organizationId,
      },
    }
  }

  /**
   * Resolve every referenced artifact to a multimodal SDK part, or finalize the run terminally and
   * return `null`. Bytes are always fetched server-side via `StorageService.download` and inlined —
   * never a signed/public URL handed to a provider (FINAL PLAN invariant 1). Scoped to
   * `runId: claim.id` as a defense-in-depth check: the producer (Arc G G.3) already bound exactly
   * these ids to this run in the same transaction that persisted the input turn, so a mismatch here
   * would mean data corruption, not a normal race.
   */
  private async resolveArtifacts(
    claim: ClaimedRun,
    artifactIds: string[]
  ): Promise<AiUserContentPart[] | null> {
    const capabilities = modelCapabilitiesFromSnapshot(claim.modelSnapshot)
    const found = await this.latch.run(() =>
      this.prisma.aiArtifact.findMany({
        where: { id: { in: artifactIds }, runId: claim.id },
        select: { id: true, kind: true, contentType: true, storageKey: true },
      })
    )
    if (found === CUTOFF) return null
    const rows = found
    const byId = new Map(rows.map((row) => [row.id, row]))

    const parts: AiUserContentPart[] = []
    for (const artifactId of artifactIds) {
      const row = byId.get(artifactId)
      if (row === undefined) {
        this.metrics.incAiArtifactResolution('not_found')
        await this.transitions.failed(claim, AiRunErrorCode.ARTIFACT_UNAVAILABLE)
        return null
      }
      const capability = capabilityForArtifactKind(row.kind)
      if (capability === null || capabilities[capability] !== true) {
        this.metrics.incAiArtifactResolution('capability_unsupported')
        await this.transitions.failed(claim, AiRunErrorCode.ARTIFACT_UNAVAILABLE)
        return null
      }
      let data: Buffer
      try {
        const downloaded = await this.latch.run(() => this.storage.download(row.storageKey))
        if (downloaded === CUTOFF) return null
        data = downloaded
      } catch (error) {
        this.metrics.incAiArtifactResolution('storage_error')
        // A genuinely missing/deleted object is permanent — no retry can fix it. Any other storage
        // fault (network blip, provider hiccup, transient credential/timeout error) is retried
        // through the existing PG-owned retry schedule instead of permanently failing the run,
        // mirroring how `AiRunLoopFinalizer.gatewayError` treats an unexpected non-gateway error.
        if (error instanceof StorageObjectNotFoundError) {
          await this.transitions.failed(claim, AiRunErrorCode.ARTIFACT_UNAVAILABLE)
        } else {
          this.logger.error(
            { event: 'ai.run.artifact_storage_retry', runId: claim.id },
            'Transient artifact storage fetch failure; scheduling retry'
          )
          await this.transitions.retry(claim, AiRunErrorCode.ARTIFACT_UNAVAILABLE)
        }
        return null
      }
      parts.push(
        row.kind === AiArtifactKind.IMAGE
          ? { type: 'image', data, mediaType: row.contentType }
          : { type: 'file', data, mediaType: row.contentType }
      )
      this.metrics.incAiArtifactResolution('success')
    }
    return parts
  }

  /**
   * Enforce the Arc D input-side guardrails: always-on oversize, then the mode-gated heuristic input
   * scan. Returns the flag categories to record on success (empty if allowed/off), or `null` when a
   * refusal was already finalized (oversize, or a `block` verdict in `block` mode).
   */
  private async runInputGuards(
    claim: ClaimedRun,
    inputText: string
  ): Promise<GuardrailStepCategory[] | null> {
    const maxInputChars = this.env.get('AI_GUARDRAIL_MAX_INPUT_CHARS')
    if (inputText.length > maxInputChars) {
      await this.transitions.refusal(claim, {
        reasonCode: AiRunTerminalReason.GUARDRAIL_INPUT_TOO_LARGE,
        checkStepType: AiRunStepType.GUARDRAIL_CHECK,
      })
      return null
    }

    const mode = this.env.get('AI_GUARDRAIL_INPUT_MODE')
    if (mode === 'off') return []
    const verdict = scanInput(inputText)
    this.metrics.incAiGuardrailCheck('input', verdict.verdict)
    if (mode === 'block' && verdict.verdict === 'block') {
      await this.transitions.refusal(claim, {
        reasonCode: AiRunTerminalReason.GUARDRAIL_INPUT_BLOCKED,
        checkStepType: AiRunStepType.GUARDRAIL_CHECK,
        categories: verdict.categories,
      })
      return null
    }
    return verdict.verdict === 'flag' ? verdict.categories : []
  }
}

/** Concatenate the text parts of a structured message content. */
function extractText(content: Prisma.JsonValue): string {
  if (!Array.isArray(content)) return ''
  const texts: string[] = []
  for (const part of content) {
    if (
      part !== null &&
      typeof part === 'object' &&
      !Array.isArray(part) &&
      (part as Record<string, unknown>).type === 'text' &&
      typeof (part as Record<string, unknown>).text === 'string'
    ) {
      texts.push((part as Record<string, unknown>).text as string)
    }
  }
  return texts.join('\n')
}

/**
 * Pull every `artifact_ref` part's id out of a structured message content, in first-seen order,
 * deduplicated (Arc G) — a duplicate reference to the same artifact resolves once (one storage
 * fetch, one provider part), never twice.
 */
function extractArtifactIds(content: Prisma.JsonValue): string[] {
  if (!Array.isArray(content)) return []
  const ids = new Set<string>()
  for (const part of content) {
    if (
      part !== null &&
      typeof part === 'object' &&
      !Array.isArray(part) &&
      (part as Record<string, unknown>).type === 'artifact_ref' &&
      typeof (part as Record<string, unknown>).artifactId === 'string'
    ) {
      ids.add((part as Record<string, unknown>).artifactId as string)
    }
  }
  return [...ids]
}

/**
 * Defensively parse `capabilities` out of the run's frozen model snapshot (Arc G worker capability
 * backstop) — never trust the JSON blob's shape; an unexpected value is dropped rather than
 * coerced, so a malformed snapshot fails every capability check closed, not open.
 */
function modelCapabilitiesFromSnapshot(snapshot: Prisma.JsonValue): Record<string, boolean> {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {}
  const capabilities = (snapshot as Record<string, unknown>).capabilities
  if (capabilities === null || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return {}
  }
  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(capabilities as Record<string, unknown>)) {
    if (typeof value === 'boolean') result[key] = value
  }
  return result
}
