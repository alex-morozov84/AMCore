import { Injectable } from '@nestjs/common'

import type { AiRunResponse } from '@amcore/shared'

import { NotFoundException } from '../../../common/exceptions'

import { toAiRunResponse } from './ai-run.mapper'

import { PrismaService } from '@/prisma'

/**
 * Owner-scoped run reads (Track C — ADR-054, Arc C, web role). Ownership is derived from the run's
 * conversation (`conversation.ownerUserId`) — runs carry no owner of their own — and a missing or
 * not-owned run is a 404 so existence never leaks. List/cancel land in C.2.
 */
@Injectable()
export class AiRunService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwned(userId: string, id: string): Promise<AiRunResponse> {
    const run = await this.prisma.aiRun.findUnique({
      where: { id },
      include: { conversation: { select: { ownerUserId: true } } },
    })
    if (!run || run.conversation.ownerUserId !== userId) {
      throw new NotFoundException('Ai run', id)
    }
    return toAiRunResponse(run)
  }
}
