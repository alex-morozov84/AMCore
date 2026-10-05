import { createHash } from 'node:crypto'

import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'

import type { PrismaService } from '../../../../prisma'

import { TelegramLinkService } from './telegram-link.service'

import type { AuditLogService } from '@/core/audit/audit-log.service'
import type { EnvService } from '@/env/env.service'

describe('TelegramLinkService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let audit: DeepMockProxy<AuditLogService>
  let env: { get: jest.Mock }
  let service: TelegramLinkService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    audit = mockDeep<AuditLogService>()
    env = { get: jest.fn().mockReturnValue('amcore_bot') }
    service = new TelegramLinkService(
      prisma as unknown as PrismaService,
      env as unknown as EnvService,
      audit as unknown as AuditLogService
    )
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
  })

  describe('issueLink', () => {
    it('stores only the token hash and returns a t.me deep link with expiry', async () => {
      prisma.telegramLinkToken.create.mockResolvedValue({} as never)
      const result = await service.issueLink('user-1')

      expect(result.url).toMatch(/^https:\/\/t\.me\/amcore_bot\?start=[A-Za-z0-9_-]{43}$/)
      expect(typeof result.expiresAt).toBe('string')

      const rawToken = result.url.split('start=')[1]!
      const createArg = prisma.telegramLinkToken.create.mock.calls[0]![0]
      expect(createArg.data.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'))
      // The raw token is never stored.
      expect(JSON.stringify(createArg)).not.toContain(rawToken)
    })
  })

  describe('getConnection', () => {
    it('returns disconnected when no connection exists', async () => {
      prisma.telegramConnection.findUnique.mockResolvedValue(null)
      expect(await service.getConnection('user-1')).toEqual({
        connected: false,
        status: null,
        linkedAt: null,
      })
    })

    it('returns active status without exposing a chat id', async () => {
      const linkedAt = new Date('2026-06-21T00:00:00.000Z')
      prisma.telegramConnection.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        linkedAt,
      } as never)
      expect(await service.getConnection('user-1')).toEqual({
        connected: true,
        status: 'active',
        linkedAt: linkedAt.toISOString(),
      })
    })

    it('maps a BLOCKED connection to status blocked', async () => {
      prisma.telegramConnection.findUnique.mockResolvedValue({
        status: 'BLOCKED',
        linkedAt: new Date(),
      } as never)
      expect((await service.getConnection('user-1')).status).toBe('blocked')
    })
  })

  describe('unlink', () => {
    it('locks the connection, cancels ALL active deliveries (incl. PROCESSING), deletes and audits — in one tx', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'conn-1' }] as never) // the connection, FOR UPDATE
        .mockResolvedValueOnce([{ id: 'd-processing' }] as never) // cancelled ids

      await service.unlink('user-1')

      const lockSql = prisma.$queryRaw.mock.calls[0]![0] as unknown as {
        sql: string
        values: unknown[]
      }
      expect(lockSql.sql).toContain('FOR UPDATE')
      expect(lockSql.values).toContain('user-1')
      const cancelSql = prisma.$queryRaw.mock.calls[1]![0] as unknown as {
        sql: string
        values: unknown[]
      }
      expect(cancelSql.sql).toContain("'PROCESSING'")
      expect(cancelSql.values).toEqual(
        expect.arrayContaining(['telegram_connection_unlinked', 'telegram', 'conn-1'])
      )
      expect(prisma.notificationDeliveryAttempt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deliveryId: { in: ['d-processing'] }, outcome: null },
          data: expect.objectContaining({ outcome: 'ABANDONED', errorCode: 'delivery_cancelled' }),
        })
      )
      expect(prisma.telegramConnection.delete).toHaveBeenCalledWith({ where: { id: 'conn-1' } })
      // Recorded as a bounded TELEGRAM_CONNECTION event, passing a tx handle (atomic; e2e proves it).
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'telegram.connection_unlinked',
          targetType: 'TELEGRAM_CONNECTION',
          targetId: 'conn-1',
        }),
        expect.anything()
      )
    })

    it('is a no-op when the user has no connection (also for a concurrent second unlink)', async () => {
      prisma.$queryRaw.mockResolvedValue([] as never)
      await service.unlink('user-1')
      expect(prisma.telegramConnection.delete).not.toHaveBeenCalled()
      expect(audit.record).not.toHaveBeenCalled()
    })
  })
})
