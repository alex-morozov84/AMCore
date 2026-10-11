import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { PrismaService } from '../../prisma'

import { NotificationRetentionService } from './notification-retention.service'

import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import type { SingletonCronRunner } from '@/infrastructure/schedule/singleton-cron.runner'

const sqlText = (sql: Prisma.Sql | TemplateStringsArray): string =>
  ('strings' in sql ? sql.strings : sql).join('')

describe('NotificationRetentionService', () => {
  let service: NotificationRetentionService
  let prisma: DeepMockProxy<PrismaClient>
  let singletonCron: jest.Mocked<Pick<SingletonCronRunner, 'run'>>
  let mockLogger: jest.Mocked<PinoLogger>

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    prisma.$queryRaw.mockResolvedValue([])
    prisma.$executeRaw.mockResolvedValue(0)
    prisma.notificationDelivery.findMany.mockResolvedValue([])
    prisma.$transaction.mockImplementation((async (callback: unknown) => {
      if (typeof callback !== 'function') throw new Error('Expected interactive transaction')
      return callback(prisma)
    }) as PrismaClient['$transaction'])
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
    it('runs each protected-data bucket inside a bounded transaction', async () => {
      const result = await service.runRetention()
      expect(result.failures).toEqual([])
      expect(prisma.$transaction).toHaveBeenCalledTimes(4)
      for (const [, options] of prisma.$transaction.mock.calls)
        expect(options).toEqual({ timeout: 5000 })
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

    it('keeps protected rows out of candidate parents and still rechecks locked children', async () => {
      await service.runRetention()
      const reads = prisma.$queryRaw.mock.calls.map(([sql]) => sqlText(sql as Prisma.Sql))
      const parents = reads.filter(
        (text) => text.includes('WHERE') && text.includes('notifications.notifications n')
      )
      expect(parents).toHaveLength(4)
      for (const text of parents.slice(0, 3)) {
        expect(text).toContain('NOT EXISTS')
        expect(text).toContain('unresolvedEffectCount')
        expect(text).toContain('legacyUnverified')
        expect(text).toContain('manualGrant')
        expect(text).toContain('FOR UPDATE SKIP LOCKED LIMIT 50')
      }
      expect(prisma.notificationDelivery.deleteMany).not.toHaveBeenCalled()
    })

    it('reports a failed bucket while continuing other independent buckets', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('lock timeout'))
      const result = await service.runRetention()
      expect(result.failures).toEqual(['archivedNotifications'])
      expect(prisma.$transaction).toHaveBeenCalledTimes(4)
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2)
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'notification.retention_partial_failure',
          bucket: 'archivedNotifications',
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
