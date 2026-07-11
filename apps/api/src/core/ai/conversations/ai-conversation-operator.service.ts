import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import {
  aiControlReasonSchema,
  type AiConversationResponse,
  type RequestPrincipal,
  SystemRole,
} from '@amcore/shared'

import { BadRequestException, NotFoundException } from '../../../common/exceptions'
import { assertSessionFresh } from '../../auth/session-freshness'

import { AiConversationControlService, type ControlActor } from './ai-conversation-control.service'

import { EnvService } from '@/env/env.service'
import { PrismaService } from '@/prisma'

/** The authorization verdict for one operator action on a conversation. */
interface AuthorizedActor {
  actor: ControlActor
  /** True when a SUPER_ADMIN is acting on a conversation they do NOT own (privileged support access). */
  isCrossUser: boolean
  /** The validated (trimmed, control-char-free) reason to record, or `undefined` for an owner who omitted it. */
  reason: string | undefined
}

/**
 * Bearer HTTP orchestration for human takeover / operator review (Track C — ADR-054, Arc F.3, web
 * role). It wraps the Arc F.2b takeover primitive with the request-layer security the primitive can't
 * see: **no-leak access** (owner or SUPER_ADMIN, else 404), and — **only for a cross-user SUPER_ADMIN
 * operator** — mandatory step-up freshness (ADR-037) **and** a bounded reason/ticket ref. An owner
 * acting on their own conversation needs neither. The state machine + audit + metrics stay in the
 * F.2b `AiConversationControlService`; this layer only gates and delegates. Bearer-only (the controller
 * pins the JWT branch, so API keys never reach here).
 */
@Injectable()
export class AiConversationOperatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly control: AiConversationControlService,
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
   * Resolve + authorize the actor for a conversation action. Reads only the immutable `ownerUserId`
   * (unlocked — the primitive re-locks and re-checks the state machine): a missing conversation, or an
   * actor who is neither the owner nor a SUPER_ADMIN, is a `404` so existence never leaks. For a
   * **cross-user** SUPER_ADMIN operator, step-up freshness (403 `STEP_UP_REQUIRED` if stale) and a
   * bounded reason (`400` if absent) are mandatory; an owner acting on their own conversation skips both.
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
    // sanitizer accepts — so a reason that passes here is one that survives into the audit (no silent
    // loss). Defense-in-depth: enforced here, not only at the DTO, so a direct call can't slip `''`,
    // whitespace, or a control-char value through.
    let validatedReason: string | undefined
    if (reason !== undefined) {
      const parsed = aiControlReasonSchema.safeParse(reason)
      if (!parsed.success) {
        throw new BadRequestException('The reason (ticket reference) is invalid.')
      }
      validatedReason = parsed.data
    }

    const isCrossUser = isSuperAdmin && conversation.ownerUserId !== principal.sub
    if (isCrossUser) {
      // Step-up freshness is required BEFORE any mutation, then a valid reason must be present.
      await assertSessionFresh(this.prisma, this.env.get('STEP_UP_MAX_AGE_SECONDS'), principal)
      if (validatedReason === undefined) {
        throw new BadRequestException(
          'A reason (ticket reference) is required for a cross-user operator action.'
        )
      }
    }

    return {
      actor: { userId: principal.sub, isSuperAdmin },
      isCrossUser,
      reason: validatedReason,
    }
  }
}
