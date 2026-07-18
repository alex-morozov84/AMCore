import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type {
  AiAssistantListQuery,
  AiAssistantListResponse,
  AiAssistantResponse,
  CreateAiAssistantInput,
  PublishAiAssistantVersionInput,
  RequestPrincipal,
  UpdateAiAssistantInput,
} from '@amcore/shared'

import { ConflictException, NotFoundException } from '../../../common/exceptions'
import { AuditLogService } from '../../audit'

import { toAiAssistantResponse } from './ai-assistant-admin.mapper'

import {
  type AiAssistant,
  AuditActorType,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client'
import { type AiMetricsAssistantAdminAction, MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/** Which bounded audit action + metric a mutation records. */
type AssistantAdminAction =
  | 'ai.assistant.created'
  | 'ai.assistant.version_published'
  | 'ai.assistant.updated'
  | 'ai.assistant.enabled'
  | 'ai.assistant.disabled'

/**
 * Assistant-registry admin surface (Track C — ADR-054, Arc F.1, web role, SUPER_ADMIN). Owns the
 * DB-backed `AiAssistant` catalog: create a new slug (version 1), publish a new **immutable** version,
 * in-place update of the two operational fields (`enabled`/`displayName`) only, and read/list. Every
 * mutation writes a **content-free** `ai.assistant.*` audit event **in the same transaction** as the
 * write (security evidence, ADR-045) — the metadata carries `slug`/`version`/`enabled`, never the
 * `systemPrompt` text, model, or tool config. No provider or tool I/O. Assistants are read live by the
 * worker each run (no catalog snapshot cache), so no registry invalidation is required here.
 */
@Injectable()
export class AiAssistantAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiAssistantAdminService.name)
  }

  /** Create a brand-new assistant slug at version 1. A slug that already exists is a `409`. */
  async create(
    actor: RequestPrincipal,
    input: CreateAiAssistantInput
  ): Promise<AiAssistantResponse> {
    const existing = await this.prisma.aiAssistant.findFirst({
      where: { slug: input.slug },
      select: { id: true },
    })
    if (existing) {
      throw new ConflictException(
        `Assistant "${input.slug}" already exists; publish a new version instead.`
      )
    }

    let assistant: AiAssistant
    try {
      assistant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.aiAssistant.create({
          data: { ...this.toVersionData(input), slug: input.slug, version: 1 },
        })
        await this.recordAudit(tx, actor, 'ai.assistant.created', created)
        return created
      })
    } catch (error) {
      // The pre-check is a fast path only — a concurrent create can still win the (slug, version)
      // unique constraint, so map its P2002 to the same 409 rather than a bubbled internal error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `Assistant "${input.slug}" already exists; publish a new version instead.`
        )
      }
      throw error
    }

    this.afterMutation('created', actor, assistant)
    return toAiAssistantResponse(assistant)
  }

  /** Publish the next immutable version of an existing slug. Unknown slug → `404`; a version race → `409`. */
  async publishVersion(
    actor: RequestPrincipal,
    slug: string,
    input: PublishAiAssistantVersionInput
  ): Promise<AiAssistantResponse> {
    const { _max } = await this.prisma.aiAssistant.aggregate({
      where: { slug },
      _max: { version: true },
    })
    if (_max.version === null) throw new NotFoundException('Ai assistant', slug)
    const nextVersion = _max.version + 1

    let assistant: AiAssistant
    try {
      assistant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.aiAssistant.create({
          data: { ...this.toVersionData(input), slug, version: nextVersion },
        })
        await this.recordAudit(tx, actor, 'ai.assistant.version_published', created)
        return created
      })
    } catch (error) {
      // A concurrent publish claimed the same (slug, version) — the @@unique constraint rejected it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A newer version was published concurrently; retry.')
      }
      throw error
    }

    this.afterMutation('version_published', actor, assistant)
    return toAiAssistantResponse(assistant)
  }

  /** In-place update of `enabled`/`displayName` only (behavioral fields are versioned, never patched). */
  async update(
    actor: RequestPrincipal,
    id: string,
    input: UpdateAiAssistantInput
  ): Promise<AiAssistantResponse> {
    const before = await this.prisma.aiAssistant.findUnique({ where: { id } })
    if (!before) throw new NotFoundException('Ai assistant', id)

    const changesEnabled = input.enabled !== undefined && input.enabled !== before.enabled
    const changesName = input.displayName !== undefined && input.displayName !== before.displayName
    // No-op: nothing actually changes → no write, no audit/metric/log (a "changed" event would mislead,
    // mirroring AdminService's no-op system-role guard).
    if (!changesEnabled && !changesName) return toAiAssistantResponse(before)

    const action: AssistantAdminAction = changesEnabled
      ? input.enabled
        ? 'ai.assistant.enabled'
        : 'ai.assistant.disabled'
      : 'ai.assistant.updated'
    const assistant = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiAssistant.update({
        where: { id },
        data: { displayName: input.displayName, enabled: input.enabled },
      })
      await this.recordAudit(tx, actor, action, updated)
      return updated
    })

    this.afterMutation(actionToMetric(action), actor, assistant)
    return toAiAssistantResponse(assistant)
  }

  /** Fetch one assistant version by id. */
  async get(id: string): Promise<AiAssistantResponse> {
    const assistant = await this.prisma.aiAssistant.findUnique({ where: { id } })
    if (!assistant) throw new NotFoundException('Ai assistant', id)
    return toAiAssistantResponse(assistant)
  }

  /**
   * List assistants (paged). `version=all` or a `slug` filter returns every matching version (newest
   * first); the default returns one row per slug at its highest version (the latest-per-slug view).
   */
  async list(query: AiAssistantListQuery): Promise<AiAssistantListResponse> {
    const { page, limit } = query
    const skip = (page - 1) * limit

    if (query.version === 'all' || query.slug !== undefined) {
      const where = query.slug !== undefined ? { slug: query.slug } : {}
      const [rows, total] = await Promise.all([
        this.prisma.aiAssistant.findMany({
          where,
          orderBy: [{ slug: 'asc' }, { version: 'desc' }],
          skip,
          take: limit,
        }),
        this.prisma.aiAssistant.count({ where }),
      ])
      return { data: rows.map(toAiAssistantResponse), total, page, limit }
    }

    // Latest-per-slug: paginate over distinct slugs, then fetch each slug's highest version.
    const groups = await this.prisma.aiAssistant.groupBy({
      by: ['slug'],
      _max: { version: true },
      orderBy: { slug: 'asc' },
      skip,
      take: limit,
    })
    const rows = await this.prisma.aiAssistant.findMany({
      where: { OR: groups.map((g) => ({ slug: g.slug, version: g._max.version ?? 0 })) },
      orderBy: { slug: 'asc' },
    })
    const distinctSlugs = await this.prisma.aiAssistant.groupBy({ by: ['slug'], _count: true })
    return { data: rows.map(toAiAssistantResponse), total: distinctSlugs.length, page, limit }
  }

  /** Map a create/publish input to the shared Prisma columns (behavioral config of one version). */
  private toVersionData(
    input: CreateAiAssistantInput | PublishAiAssistantVersionInput
  ): Omit<Prisma.AiAssistantCreateInput, 'slug' | 'version'> {
    return {
      displayName: input.displayName,
      enabled: input.enabled,
      systemPrompt: input.systemPrompt ?? null,
      modelSelection: input.modelSelection as unknown as Prisma.InputJsonValue,
      allowedModalities: input.allowedModalities,
      toolAllowlist: input.toolAllowlist,
      budgetClass: input.budgetClass ?? null,
    }
  }

  /** Content-free in-tx audit — never carries the systemPrompt/model/tool config, only bounded ids. */
  private async recordAudit(
    tx: Prisma.TransactionClient,
    actor: RequestPrincipal,
    action: AssistantAdminAction,
    assistant: AiAssistant
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        actorId: actor.sub,
        actorType: AuditActorType.USER,
        targetType: AuditTargetType.AI_ASSISTANT,
        targetId: assistant.id,
        metadata: {
          slug: assistant.slug,
          version: assistant.version,
          enabled: assistant.enabled,
          pinoEvent: 'ai.admin.assistant_mutated',
        },
      },
      { tx }
    )
  }

  /** Post-commit metric + content-free log (never the prompt/config). */
  private afterMutation(
    action: AiMetricsAssistantAdminAction,
    actor: RequestPrincipal,
    assistant: AiAssistant
  ): void {
    this.metrics.incAiAssistantAdmin(action)
    this.logger.info(
      {
        event: 'ai.admin.assistant_mutated',
        action,
        actorUserId: actor.sub,
        assistantId: assistant.id,
        slug: assistant.slug,
        version: assistant.version,
        enabled: assistant.enabled,
      },
      'AI assistant admin mutation'
    )
  }
}

/** Map the bounded audit action to its bounded metric label. */
function actionToMetric(action: AssistantAdminAction): AiMetricsAssistantAdminAction {
  return action.slice('ai.assistant.'.length) as AiMetricsAssistantAdminAction
}
