import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PinoLogger } from 'nestjs-pino'

import type { AiUsage, AiUsageContext } from '../gateway/ai-gateway.types'

import { PrismaService } from '@/prisma'

/** What the gateway records after a successful generation. No prompt/response content, no secret. */
export interface AiUsageRecord {
  modelSlug: string
  usage: AiUsage
  context?: AiUsageContext
}

/**
 * Authoritative AI usage/cost ledger writer (Track C — ADR-054, Arc B). Appends one
 * `AiUsageLedger` row per generation. The ledger is a snapshot/no-FK accounting record, so every
 * attribution id is stored as-is. `estimatedCost`/`currency` are left null for now — token counts
 * and the provider-reported usage are the source of truth; price computation matures in a later
 * arc. Recording is **best-effort**: a ledger write must never fail or roll back a generation that
 * already incurred provider cost (Arc C will record transactionally inside the durable run).
 */
@Injectable()
export class AiUsageLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiUsageLedgerService.name)
  }

  async record(input: AiUsageRecord): Promise<void> {
    try {
      await this.prisma.aiUsageLedger.create({
        data: {
          modelSlug: input.modelSlug,
          runId: input.context?.runId ?? null,
          conversationId: input.context?.conversationId ?? null,
          userId: input.context?.userId ?? null,
          organizationId: input.context?.organizationId ?? null,
          apiKeyId: input.context?.apiKeyId ?? null,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          providerReportedUsage: {
            inputTokens: input.usage.inputTokens,
            outputTokens: input.usage.outputTokens,
            totalTokens: input.usage.totalTokens,
          } satisfies Prisma.InputJsonValue,
          usageVersion: 1,
        },
      })
    } catch (error) {
      // Accounting must not break a generation that already succeeded; surface by slug only.
      this.logger.warn(
        { modelSlug: input.modelSlug, error: error instanceof Error ? error.name : 'unknown' },
        'Failed to record AI usage ledger row'
      )
    }
  }
}
