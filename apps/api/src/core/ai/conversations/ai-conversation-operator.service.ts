import { Injectable } from '@nestjs/common'
import {
  AiAuthorType,
  AiConversationControl,
  AiMessageRole,
  AuditActorType,
  AuditTargetType,
  Prisma,
} from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import {
  aiControlReasonSchema,
  type AiConversationResponse,
  type AiMessageResponse,
  type AiTranscriptQuery,
  type AiTranscriptResponse,
  type PostOperatorMessageInput,
  type RequestPrincipal,
  SystemRole,
} from '@amcore/shared'

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '../../../common/exceptions'
import { assertSessionFresh } from '../../auth/session-freshness'
import { toAiMessageResponse } from '../runs/ai-run.mapper'

import { AiConversationControlService, type ControlActor } from './ai-conversation-control.service'

import { AuditLogService } from '@/core/audit'
import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { PrismaService } from '@/prisma'

/** The authorization verdict for one operator action on a conversation. */
interface AuthorizedActor {
  actor: ControlActor
  /** True when a SUPER_ADMIN is acting on a conversation they do NOT own (privileged support access). */
  isCrossUser: boolean
  /** The validated (trimmed, control-char-free) reason to record, or `undefined` for an owner who omitted it. */
  reason: string | undefined
}

/** The conversation's holder columns, read under `FOR UPDATE` for the operator-message write. */
interface HolderRow {
  ownerUserId: string
  controlledBy: string
  humanControlUserId: string | null
}

/**
 * Bearer HTTP orchestration for human takeover / operator review (Track C — ADR-054, Arc F.3, web
 * role). It wraps the Arc F.2b takeover primitive + the transcript/operator-message surface with the
 * request-layer security the primitive can't see: **no-leak access** (owner or SUPER_ADMIN, else 404),
 * and — **only for a cross-user SUPER_ADMIN operator** — mandatory step-up freshness (ADR-037) **and** a
 * bounded reason/ticket ref. An owner acting on their own conversation needs neither. Content-free
 * audit + bounded metrics; never a prompt/message/reason in logs/metrics. Bearer-only (the controller
 * pins the JWT branch, so API keys never reach here).
 */
@Injectable()
export class AiConversationOperatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly control: AiConversationControlService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiConversationOperatorService.name)
  }

  /** Take human control (owner, or cross-user SUPER_ADMIN with step-up + reason). */
  async takeover(
    principal: RequestPrincipal,
    conversationId: string,
    reason?: string
  ): Promise<AiConversationResponse> {
    const authorized = await this.authorize(principal, conversationId, reason)
    return this.control.takeControl(authorized.actor, conversationId, authorized.reason)
  }

  /** Release control back to the bot (holder or owner; cross-user SUPER_ADMIN needs step-up + reason). */
  async release(
    principal: RequestPrincipal,
    conversationId: string,
    reason?: string
  ): Promise<AiConversationResponse> {
    const authorized = await this.authorize(principal, conversationId, reason)
    return this.control.releaseControl(authorized.actor, conversationId, authorized.reason)
  }

  /**
   * Read the conversation transcript (keyset by `sequence`, oldest first). Owner or cross-user operator;
   * a cross-user read is step-up-gated, reason-gated, and **audited** (`ai.conversation.transcript_accessed`,
   * content-free) before the transcript is returned — privileged-access accountability. The message
   * `content` is returned to the authorized reader (that is the review), but never logged or audited.
   */
  async getTranscript(
    principal: RequestPrincipal,
    conversationId: string,
    query: AiTranscriptQuery,
    reason?: string
  ): Promise<AiTranscriptResponse> {
    const authorized = await this.authorize(principal, conversationId, reason)

    const rows = await this.prisma.aiMessage.findMany({
      where: {
        conversationId,
        ...(query.cursor !== undefined ? { sequence: { gt: query.cursor } } : {}),
      },
      orderBy: { sequence: 'asc' },
      take: query.limit + 1,
    })
    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    const nextCursor = hasMore ? String(page[page.length - 1]!.sequence) : null

    if (authorized.isCrossUser) {
      // Fail-closed accountability: the privileged read is audited BEFORE the transcript is returned.
      await this.audit.record({
        action: 'ai.conversation.transcript_accessed',
        actorType: AuditActorType.USER,
        actorId: authorized.actor.userId,
        targetType: AuditTargetType.AI_CONVERSATION,
        targetId: conversationId,
        metadata: {
          conversationId,
          actorRole: 'operator',
          messageCount: page.length,
          reasonRef: authorized.reason,
        },
      })
    }

    return { data: page.map(toAiMessageResponse), nextCursor, hasMore }
  }

  /**
   * Post a human turn while holding control (Arc F.3b). The turn is a `role=ASSISTANT` message authored
   * by the human (`authorType=OPERATOR` cross-user, `USER` owner) — the human occupies the assistant
   * seat during takeover. Under the conversation `FOR UPDATE` lock it asserts the actor **currently
   * holds** control (`controlledBy=HUMAN` and `humanControlUserId=actor`, else `409`) — so an operator
   * who has not taken over, or a post after release, cannot write, and no bot run can race the append
   * (the takeover superseded them + the fence blocks any straggler). Audit is content-free + in-tx.
   */
  async postMessage(
    principal: RequestPrincipal,
    conversationId: string,
    input: PostOperatorMessageInput
  ): Promise<AiMessageResponse> {
    const authorized = await this.authorize(principal, conversationId, input.reason)

    const { message, authorType } = await this.prisma.$transaction(async (tx) => {
      const holder = await this.lockHolder(tx, conversationId)
      if (
        holder.controlledBy !== AiConversationControl.HUMAN ||
        holder.humanControlUserId !== authorized.actor.userId
      ) {
        throw new ConflictException(
          'You do not hold control of this conversation; take it over before posting.'
        )
      }
      const isOwner = holder.ownerUserId === authorized.actor.userId
      const authorType = isOwner ? AiAuthorType.USER : AiAuthorType.OPERATOR
      const sequence = await this.nextSequence(tx, conversationId)
      const created = await tx.aiMessage.create({
        data: {
          conversationId,
          sequence,
          role: AiMessageRole.ASSISTANT,
          authorType,
          authorUserId: authorized.actor.userId,
          content: input.content as unknown as Prisma.InputJsonValue,
        },
      })
      await this.audit.record(
        {
          action: 'ai.conversation.operator_message',
          actorType: AuditActorType.USER,
          actorId: authorized.actor.userId,
          targetType: AuditTargetType.AI_CONVERSATION,
          targetId: conversationId,
          metadata: {
            conversationId,
            messageId: created.id,
            authorType: authorType.toLowerCase(),
            actorRole: authorized.isCrossUser ? 'operator' : 'owner',
            reasonRef: authorized.reason,
          },
        },
        { tx }
      )
      return { message: created, authorType }
    })

    this.metrics.incAiConversationControl(
      'operator_message',
      authorized.isCrossUser ? 'operator' : 'owner'
    )
    this.logger.info(
      {
        event: 'ai.conversation.operator_message',
        conversationId,
        messageId: message.id,
        actorUserId: authorized.actor.userId,
        authorType: authorType.toLowerCase(),
      },
      'AI conversation operator message posted'
    )
    return toAiMessageResponse(message)
  }

  /**
   * Resolve + authorize the actor. Reads only the immutable `ownerUserId` (unlocked): a missing
   * conversation, or an actor who is neither the owner nor a SUPER_ADMIN, is a `404` (no existence
   * leak). Any supplied reason is validated against the audit-aligned grammar (`400` if invalid). For a
   * **cross-user** operator, step-up freshness (403 before any mutation) and a valid reason (`400`) are
   * mandatory; an owner acting on their own conversation skips both.
   */
  private async authorize(
    principal: RequestPrincipal,
    conversationId: string,
    reason: string | undefined
  ): Promise<AuthorizedActor> {
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      select: { ownerUserId: true },
    })
    const isSuperAdmin = principal.systemRole === SystemRole.SuperAdmin
    if (!conversation || (conversation.ownerUserId !== principal.sub && !isSuperAdmin)) {
      throw new NotFoundException('Conversation', conversationId)
    }

    // Validate any supplied reason against the SAME bounded, control-char-free grammar the audit
    // sanitizer accepts — a reason that passes here survives into the audit (no silent loss).
    let validatedReason: string | undefined
    if (reason !== undefined) {
      const parsed = aiControlReasonSchema.safeParse(reason)
      if (!parsed.success)
        throw new BadRequestException('The reason (ticket reference) is invalid.')
      validatedReason = parsed.data
    }

    const isCrossUser = isSuperAdmin && conversation.ownerUserId !== principal.sub
    if (isCrossUser) {
      await assertSessionFresh(this.prisma, this.env.get('STEP_UP_MAX_AGE_SECONDS'), principal)
      if (validatedReason === undefined) {
        throw new BadRequestException(
          'A reason (ticket reference) is required for a cross-user operator action.'
        )
      }
    }

    return { actor: { userId: principal.sub, isSuperAdmin }, isCrossUser, reason: validatedReason }
  }

  /** Lock the conversation `FOR UPDATE` and read the holder columns for the operator-message assertion. */
  private async lockHolder(
    tx: Prisma.TransactionClient,
    conversationId: string
  ): Promise<HolderRow> {
    const rows = await tx.$queryRaw<HolderRow[]>(Prisma.sql`
      SELECT "ownerUserId", "controlledBy"::text AS "controlledBy", "humanControlUserId"
      FROM "ai"."ai_conversations"
      WHERE id = ${conversationId}
      FOR UPDATE
    `)
    const row = rows[0]
    if (row === undefined) throw new NotFoundException('Conversation', conversationId)
    return row
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
}
