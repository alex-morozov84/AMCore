import { Injectable } from '@nestjs/common'

import type { AiConversationResponse, CreateAiConversationInput } from '@amcore/shared'

import { BadRequestException, NotFoundException } from '../../../common/exceptions'
import { toAiConversationResponse } from '../runs/ai-run.mapper'

import { PrismaService } from '@/prisma'

/**
 * Conversation surface (Track C — ADR-054, Arc C, web role). Owns create + owner-scoped fetch of
 * durable conversations. `assistantId` is only **validated and bound** here — no assistant policy
 * (model selection, guardrails, tools) is applied until Arc F; binding an `assistantId` now keeps
 * the contract stable. Ownership is per-user via `ownerUserId` (org-shared AI is deferred), and a
 * not-owned/missing conversation is a 404 so existence never leaks.
 */
@Injectable()
export class AiConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateAiConversationInput): Promise<AiConversationResponse> {
    const assistantId = input.assistantId ?? null
    if (assistantId !== null) await this.assertAssistantExists(assistantId)

    const conversation = await this.prisma.aiConversation.create({
      data: { ownerUserId: userId, assistantId, title: input.title ?? null },
    })
    return toAiConversationResponse(conversation)
  }

  async getOwned(userId: string, id: string): Promise<AiConversationResponse> {
    const conversation = await this.prisma.aiConversation.findUnique({ where: { id } })
    if (!conversation || conversation.ownerUserId !== userId) {
      throw new NotFoundException('Conversation', id)
    }
    return toAiConversationResponse(conversation)
  }

  /** Bind-time existence check only — assistant config is not interpreted until Arc F. */
  private async assertAssistantExists(assistantId: string): Promise<void> {
    const assistant = await this.prisma.aiAssistant.findUnique({
      where: { id: assistantId },
      select: { id: true },
    })
    if (!assistant) throw new BadRequestException(`Unknown assistant "${assistantId}"`)
  }
}
