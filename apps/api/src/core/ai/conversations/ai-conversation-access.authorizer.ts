import { Injectable } from '@nestjs/common'

import { aiControlReasonSchema, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { BadRequestException, NotFoundException } from '../../../common/exceptions'
import { assertSessionFresh } from '../../auth/session-freshness'

import type { ControlActor } from './ai-conversation-control.service'

import { EnvService } from '@/env/env.service'
import { PrismaService } from '@/prisma'

/** The authorization verdict for one privileged action on a conversation (Track C — ADR-054, Arc F). */
export interface AuthorizedActor {
  actor: ControlActor
  /** True when a SUPER_ADMIN is acting on a conversation they do NOT own (privileged support access). */
  isCrossUser: boolean
  /** The validated (trimmed, control-char-free) reason to record, or `undefined` for an owner who omitted it. */
  reason: string | undefined
}

/**
 * The single source of truth for **conversation-content access authorization** (Track C — ADR-054,
 * Arc F, extracted in Arc G so the operator-review surface and the artifact-download surface share
 * one implementation — cross-user authorization is security-critical and must never be duplicated).
 *
 * Access is the conversation **owner** OR a cross-user **SUPER_ADMIN operator**; anyone else (or a
 * missing conversation) is a `404` — existence never leaks. For a **cross-user** operator only, the
 * action additionally requires step-up freshness (ADR-037) **and** a bounded, content-free reason /
 * ticket ref; an owner acting on their own conversation needs neither. Any supplied reason is
 * validated against the same grammar the audit sanitizer accepts, so a reason that passes here always
 * survives into the audit (no silent loss).
 */
@Injectable()
export class AiConversationAccessAuthorizer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService
  ) {}

  async authorize(
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
}
