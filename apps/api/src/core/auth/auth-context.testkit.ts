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

/** Ordinary legacy unit fixtures explicitly model the primary authority row, not an MFA bypass. */
export function installOrdinaryPrimaryFixture(
  mock: MockContext,
  user: { id: string; systemRole: string }
): void {
  mock.prisma.$queryRaw.mockImplementation(((query: unknown) => {
    const sql = query as { sql?: string; text?: string; strings?: string[] }
    const text = Array.isArray(query)
      ? query.join('')
      : (sql.sql ?? sql.text ?? sql.strings?.join('') ?? '')
    if (text.includes('WITH source'))
      return Promise.resolve([
        {
          now: new Date(),
          user: { ...user, mfaAccount: null, mfaFactor: null },
          family: null,
          protocol: { state: 'prepared', version: 1 },
          session: null,
        },
      ])
    if (text.includes('clock_timestamp')) return Promise.resolve([{ now: new Date() }])
    return Promise.resolve([])
  }) as typeof mock.prisma.$queryRaw)
}
