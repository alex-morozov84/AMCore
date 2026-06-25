import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { AiUsageLedgerService } from './ai-usage-ledger.service'

import type { PrismaService } from '@/prisma'

/**
 * Unit tests for the AI usage ledger writer (Track C — ADR-054, Arc B): it appends a row with the
 * usage + attribution snapshot and never throws (accounting must not break a completed generation).
 */

const logger = { setContext: jest.fn(), warn: jest.fn() } as never

describe('AiUsageLedgerService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let service: AiUsageLedgerService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    service = new AiUsageLedgerService(prisma as unknown as PrismaService, logger)
  })

  it('writes a ledger row with usage, attribution snapshot, and provider-reported usage', async () => {
    await service.record({
      modelSlug: 'claude-default',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      context: { userId: 'u1', runId: 'r1', organizationId: 'o1' },
    })

    expect(prisma.aiUsageLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        modelSlug: 'claude-default',
        userId: 'u1',
        runId: 'r1',
        organizationId: 'o1',
        apiKeyId: null,
        conversationId: null,
        inputTokens: 10,
        outputTokens: 5,
        providerReportedUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        usageVersion: 1,
      }),
    })
  })

  it('defaults all attribution ids to null when no context is given', async () => {
    await service.record({
      modelSlug: 'mock-default',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })
    const data = prisma.aiUsageLedger.create.mock.calls[0]![0].data as Record<string, unknown>
    expect(data).toMatchObject({ userId: null, runId: null, conversationId: null, apiKeyId: null })
  })

  it('swallows a DB write error (never breaks the generation)', async () => {
    prisma.aiUsageLedger.create.mockRejectedValue(new Error('db down'))
    await expect(
      service.record({
        modelSlug: 'claude-default',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })
    ).resolves.toBeUndefined()
  })
})
