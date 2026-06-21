import type { Prisma, PrismaClient } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { PrismaService } from '../../prisma'

import { NotificationRetentionService } from './notification-retention.service'

import type { SingletonCronRunner } from '@/infrastructure/schedule/singleton-cron.runner'

const sqlText = (sql: Prisma.Sql): string => sql.strings.join('')

describe('NotificationRetentionService', () => {
  let service: NotificationRetentionService
  let prisma: DeepMockProxy<PrismaClient>
  let singletonCron: jest.Mocked<Pick<SingletonCronRunner, 'run'>>
  let mockLogger: jest.Mocked<PinoLogger>

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    singletonCron = {
      run: jest.fn().mockImplementation(async (_opts, task: () => Promise<void>) => {
        await task()
      }),
    } as jest.Mocked<Pick<SingletonCronRunner, 'run'>>
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<PinoLogger>
    service = new NotificationRetentionService(
      prisma as unknown as PrismaService,
      singletonCron as unknown as SingletonCronRunner,
      mockLogger
    )
  })

  describe('runRetention', () => {
    it('sweeps every bucket and returns per-bucket counts', async () => {
      prisma.$executeRaw
        .mockResolvedValueOnce(3) // archived
        .mockResolvedValueOnce(5) // read
        .mockResolvedValueOnce(7) // unread
        .mockResolvedValueOnce(2) // finished attempts
        .mockResolvedValueOnce(4) // telegram link tokens
        .mockResolvedValueOnce(6) // telegram update receipts

      const result = await service.runRetention()

      expect(result).toEqual({
        archivedNotifications: 3,
        readNotifications: 5,
        unreadNotifications: 7,
        finishedAttempts: 2,
        telegramLinkTokens: 4,
        telegramUpdateReceipts: 6,
        failures: [],
      })
    })

    it('prunes telegram tokens (expired/consumed only) and update receipts by age', async () => {
      prisma.$executeRaw.mockResolvedValue(0)

      await service.runRetention()

      const texts = prisma.$executeRaw.mock.calls.map(([sql]) => sqlText(sql as Prisma.Sql))
      const tokenDelete = texts.find((t) => t.includes('"telegram_link_tokens"'))
      const receiptDelete = texts.find((t) => t.includes('"telegram_update_receipts"'))
      expect(tokenDelete).toContain('"consumedAt" IS NOT NULL OR "expiresAt"')
      expect(receiptDelete).toContain('"receivedAt" <')
    })

    it('never deletes a notification that still has an active external delivery', async () => {
      prisma.$executeRaw.mockResolvedValue(0)

      await service.runRetention()

      // Each of the three notification deletes guards on active delivery statuses.
      const notificationDeletes = prisma.$executeRaw.mock.calls
        .map(([sql]) => sqlText(sql as Prisma.Sql))
        .filter((text) => text.includes('"notifications"."notifications"'))
      expect(notificationDeletes).toHaveLength(3)
      for (const text of notificationDeletes) {
        expect(text).toContain('NOT EXISTS')
        expect(text).toContain("'PENDING', 'PROCESSING', 'RETRY_SCHEDULED'")
      }
    })

    it('keeps deleting in batches until a short batch is returned', async () => {
      // First archived batch fills the limit (loop continues), everything else is short.
      prisma.$executeRaw.mockResolvedValueOnce(500).mockResolvedValue(0)

      const result = await service.runRetention()

      expect(result.archivedNotifications).toBe(500)
      // 6 first-pass calls + 1 extra archived pass that drains to 0.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(7)
    })

    it('isolates a per-bucket failure: keeps other counts, records it, never throws', async () => {
      prisma.$executeRaw
        .mockResolvedValueOnce(4) // archived
        .mockRejectedValueOnce(new Error('pool timeout')) // read
        .mockResolvedValueOnce(0) // unread
        .mockResolvedValueOnce(1) // finished attempts

      const result = await service.runRetention()

      expect(result.archivedNotifications).toBe(4)
      expect(result.readNotifications).toBe(0)
      expect(result.finishedAttempts).toBe(1)
      expect(result.failures).toEqual(['readNotifications'])
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'notification.retention_partial_failure',
          bucket: 'readNotifications',
        }),
        expect.any(String)
      )
    })
  })

  describe('scheduledRetention', () => {
    it('runs under the retention lock and logs completion', async () => {
      prisma.$executeRaw.mockResolvedValue(0)

      await service.scheduledRetention()

      expect(singletonCron.run).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'notification.retention',
          lockKey: expect.any(String),
          ttlMs: expect.any(Number),
        }),
        expect.any(Function)
      )
      expect(prisma.$executeRaw).toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'notification.retention_complete' }),
        expect.any(String)
      )
    })

    it('does not sweep when the runner skips the task (lock lost / Redis down)', async () => {
      singletonCron.run.mockResolvedValueOnce(undefined)

      await service.scheduledRetention()

      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })
  })
})
