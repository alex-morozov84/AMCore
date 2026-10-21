import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { PrismaClient } from '../../generated/prisma/client.js'
import type { PrismaService } from '../../prisma/index.js'

export type MockContext = {
  prisma: DeepMockProxy<PrismaClient>
}

export const createMockContext = (): MockContext => ({
  prisma: mockDeep<PrismaClient>(),
})

// Helper to cast MockContext to PrismaService for dependency injection
export const mockContextToPrisma = (mockCtx: MockContext): PrismaService => {
  return mockCtx.prisma as unknown as PrismaService
}
