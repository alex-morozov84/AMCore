import { jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'

import type { TelegramBotApiClient } from '../src/core/notifications/channels/telegram/telegram-bot-api.client'
import type { PrismaService } from '../src/prisma'

/** Compiled by API typecheck; deliberately never invoked at runtime. */
export function proveMockSignatures(): void {
  const prisma = mockDeep<PrismaService>()
  // @ts-expect-error Prisma user identifiers must remain strings.
  void prisma.user.findUnique({ where: { id: 123 } })
  // @ts-expect-error Generic groupBy must reject unknown fields.
  void prisma.user.groupBy({ by: ['nonexistentField'] })
  const transport = jest.fn<TelegramBotApiClient['sendPreparedMessage']>()
  // @ts-expect-error The actual transport signature rejects a string payload.
  void transport('invalid payload')
  const handler = jest.fn<() => Promise<{ id: string }>>()
  // @ts-expect-error Mock return values must retain the handler contract.
  handler.mockResolvedValue({ id: 123 })
}
