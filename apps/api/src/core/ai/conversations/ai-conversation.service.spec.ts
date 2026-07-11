import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import { BadRequestException, NotFoundException } from '../../../common/exceptions'

import { AiConversationService } from './ai-conversation.service'

import type { PrismaService } from '@/prisma'

function fakeConversation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'conv-1',
    ownerUserId: 'user-1',
    assistantId: null,
    title: null,
    state: 'ACTIVE',
    controlledBy: 'BOT',
    ownershipGeneration: 0,
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    updatedAt: new Date('2026-06-26T00:00:00.000Z'),
    closedAt: null,
    ...overrides,
  }
}

describe('AiConversationService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let service: AiConversationService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    service = new AiConversationService(prisma)
  })

  it('creates an owner-scoped conversation and projects DB enums to lowercase wire values', async () => {
    prisma.aiConversation.create.mockResolvedValue(fakeConversation() as never)

    const result = await service.create('user-1', { title: null, assistantId: null })

    expect(result).toMatchObject({ id: 'conv-1', state: 'active', controlledBy: 'bot' })
    expect(prisma.aiConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerUserId: 'user-1' }) })
    )
    expect(prisma.aiAssistant.findUnique).not.toHaveBeenCalled()
  })

  it('binds a known ENABLED assistant', async () => {
    prisma.aiAssistant.findUnique.mockResolvedValue({ enabled: true } as never)
    prisma.aiConversation.create.mockResolvedValue(
      fakeConversation({ assistantId: 'asst-1' }) as never
    )

    const result = await service.create('user-1', { assistantId: 'asst-1', title: null })

    expect(result.assistantId).toBe('asst-1')
  })

  it('rejects an unknown assistant id (400)', async () => {
    prisma.aiAssistant.findUnique.mockResolvedValue(null)

    await expect(
      service.create('user-1', { assistantId: 'ghost', title: null })
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.aiConversation.create).not.toHaveBeenCalled()
  })

  it('rejects binding a DISABLED assistant (400, Arc F.4 kill-switch)', async () => {
    prisma.aiAssistant.findUnique.mockResolvedValue({ enabled: false } as never)

    await expect(
      service.create('user-1', { assistantId: 'asst-off', title: null })
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.aiConversation.create).not.toHaveBeenCalled()
  })

  it('fetches an owned conversation', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue(fakeConversation() as never)

    await expect(service.getOwned('user-1', 'conv-1')).resolves.toMatchObject({ id: 'conv-1' })
  })

  it('hides a conversation owned by someone else (404)', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue(
      fakeConversation({ ownerUserId: 'other' }) as never
    )

    await expect(service.getOwned('user-1', 'conv-1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('404s a missing conversation', async () => {
    prisma.aiConversation.findUnique.mockResolvedValue(null)

    await expect(service.getOwned('user-1', 'missing')).rejects.toBeInstanceOf(NotFoundException)
  })
})
