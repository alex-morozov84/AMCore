import type { Prisma } from '@prisma/client'

import {
  ConversationSupersededError,
  isBotOwnershipStale,
  lockAndAssertBotOwnership,
  type OwnershipFenceRow,
  readBotOwnership,
} from './ai-run-ownership-fence'

import type { PrismaService } from '@/prisma'

const fresh: OwnershipFenceRow = { ownershipGeneration: 3, controlledBy: 'BOT', state: 'ACTIVE' }

describe('isBotOwnershipStale', () => {
  it('is fresh when generation matches, control is BOT, and state is ACTIVE', () => {
    expect(isBotOwnershipStale(fresh, 3)).toBe(false)
  })

  it('is stale when the generation advanced past the run snapshot', () => {
    expect(isBotOwnershipStale({ ...fresh, ownershipGeneration: 4 }, 3)).toBe(true)
  })

  it('is stale when a human holds control (even at the same generation)', () => {
    expect(isBotOwnershipStale({ ...fresh, controlledBy: 'HUMAN' }, 3)).toBe(true)
  })

  it('is stale when the conversation is paused or closed', () => {
    expect(isBotOwnershipStale({ ...fresh, state: 'PAUSED_FOR_HUMAN' }, 3)).toBe(true)
    expect(isBotOwnershipStale({ ...fresh, state: 'CLOSED' }, 3)).toBe(true)
  })

  it('treats a missing conversation row as stale', () => {
    expect(isBotOwnershipStale(null, 3)).toBe(true)
  })
})

describe('lockAndAssertBotOwnership', () => {
  function txReturning(rows: OwnershipFenceRow[]): Prisma.TransactionClient {
    return { $queryRaw: jest.fn().mockResolvedValue(rows) } as unknown as Prisma.TransactionClient
  }

  it('passes silently for a fresh, bot-owned, active conversation', async () => {
    await expect(
      lockAndAssertBotOwnership(txReturning([fresh]), 'conv-1', 3)
    ).resolves.toBeUndefined()
  })

  it('throws ConversationSupersededError when the generation moved', async () => {
    const tx = txReturning([{ ...fresh, ownershipGeneration: 5 }])
    await expect(lockAndAssertBotOwnership(tx, 'conv-1', 3)).rejects.toBeInstanceOf(
      ConversationSupersededError
    )
  })

  it('throws ConversationSupersededError when the conversation row is gone', async () => {
    await expect(lockAndAssertBotOwnership(txReturning([]), 'conv-1', 3)).rejects.toBeInstanceOf(
      ConversationSupersededError
    )
  })
})

describe('readBotOwnership', () => {
  it('returns the fence columns of an existing conversation', async () => {
    const prisma = {
      aiConversation: { findUnique: jest.fn().mockResolvedValue(fresh) },
    } as unknown as PrismaService

    await expect(readBotOwnership(prisma, 'conv-1')).resolves.toEqual(fresh)
  })

  it('returns null for a missing conversation', async () => {
    const prisma = {
      aiConversation: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService

    await expect(readBotOwnership(prisma, 'gone')).resolves.toBeNull()
  })
})
