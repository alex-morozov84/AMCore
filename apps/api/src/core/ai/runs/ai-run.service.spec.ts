import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { NotFoundException } from '../../../common/exceptions'

import { AiRunService } from './ai-run.service'

import type { PrismaService } from '@/prisma'

function fakeRun(ownerUserId: string): Record<string, unknown> {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    status: 'RUNNING',
    errorCode: null,
    terminalReasonCode: null,
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    startedAt: new Date('2026-06-26T00:00:01.000Z'),
    finishedAt: null,
    conversation: { ownerUserId },
  }
}

describe('AiRunService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let service: AiRunService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    service = new AiRunService(prisma)
  })

  it('fetches an owned run and projects status to a lowercase wire value', async () => {
    prisma.aiRun.findUnique.mockResolvedValue(fakeRun('user-1') as never)

    await expect(service.getOwned('user-1', 'run-1')).resolves.toMatchObject({
      id: 'run-1',
      status: 'running',
    })
  })

  it('hides a run whose conversation is owned by someone else (404)', async () => {
    prisma.aiRun.findUnique.mockResolvedValue(fakeRun('other') as never)

    await expect(service.getOwned('user-1', 'run-1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('404s a missing run', async () => {
    prisma.aiRun.findUnique.mockResolvedValue(null)

    await expect(service.getOwned('user-1', 'missing')).rejects.toBeInstanceOf(NotFoundException)
  })
})
