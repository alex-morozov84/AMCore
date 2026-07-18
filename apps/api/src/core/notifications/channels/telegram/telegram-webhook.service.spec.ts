import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { PrismaService } from '../../../../prisma'
import type { NotificationsService } from '../../notifications.service'

import { TelegramWebhookService } from './telegram-webhook.service'

import type { AuditLogService } from '@/core/audit/audit-log.service'
import type { EnvService } from '@/env/env.service'
import { Prisma } from '@/generated/prisma/client'

const TOKEN = 'a'.repeat(43)

function startBody(chatId = 555): unknown {
  return {
    update_id: 7,
    message: {
      text: `/start ${TOKEN}`,
      chat: { id: chatId, type: 'private' },
      from: { id: chatId },
    },
  }
}

describe('TelegramWebhookService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let audit: DeepMockProxy<AuditLogService>
  let notifications: DeepMockProxy<NotificationsService>
  let env: { get: jest.Mock }
  let service: TelegramWebhookService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    audit = mockDeep<AuditLogService>()
    notifications = mockDeep<NotificationsService>()
    env = { get: jest.fn().mockReturnValue('amcore_bot') }
    service = new TelegramWebhookService(
      prisma as unknown as PrismaService,
      env as unknown as EnvService,
      audit as unknown as AuditLogService,
      notifications as unknown as NotificationsService,
      mockDeep<PinoLogger>() as unknown as PinoLogger
    )
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
    // Default: a fresh receipt, no owner, no existing connection, a fresh connection row.
    prisma.telegramUpdateReceipt.createMany.mockResolvedValue({ count: 1 })
    prisma.telegramConnection.create.mockResolvedValue({ id: 'conn-new' } as never)
  })

  const lockToken = (row: { id: string; userId: string } | null): void => {
    prisma.$queryRaw.mockResolvedValue(row ? [row] : ([] as never))
  }

  it('acks without a receipt when there is no safe update_id', async () => {
    await service.processUpdate({ message: {} })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('is an effect-free no-op on a replayed update_id', async () => {
    prisma.telegramUpdateReceipt.createMany.mockResolvedValue({ count: 0 })
    await service.processUpdate(startBody())
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    expect(notifications.notify).not.toHaveBeenCalled()
  })

  it('commits the receipt but does not bind when the update is not a /start command', async () => {
    await service.processUpdate({
      update_id: 7,
      message: { text: 'hi', chat: { id: 1, type: 'private' }, from: { id: 1 } },
    })
    expect(prisma.telegramUpdateReceipt.createMany).toHaveBeenCalled()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    expect(prisma.telegramConnection.create).not.toHaveBeenCalled()
  })

  it('no-ops on an unknown/expired/consumed token', async () => {
    lockToken(null)
    await service.processUpdate(startBody())
    expect(prisma.telegramConnection.create).not.toHaveBeenCalled()
    expect(prisma.telegramLinkToken.update).not.toHaveBeenCalled()
  })

  it('rejects a foreign-owned chat WITHOUT consuming the token', async () => {
    lockToken({ id: 'tok-1', userId: 'user-1' })
    prisma.telegramConnection.findUnique.mockResolvedValueOnce({ userId: 'other-user' } as never)

    await service.processUpdate(startBody())

    expect(prisma.telegramConnection.create).not.toHaveBeenCalled()
    expect(prisma.telegramLinkToken.update).not.toHaveBeenCalled() // token stays unconsumed
    expect(notifications.notify).not.toHaveBeenCalled()
  })

  it('binds: creates the connection, consumes the token LAST, then confirms + audits', async () => {
    lockToken({ id: 'tok-1', userId: 'user-1' })
    prisma.telegramConnection.findUnique
      .mockResolvedValueOnce(null) // owner by chatId
      .mockResolvedValueOnce(null) // existing by userId

    await service.processUpdate(startBody())

    expect(prisma.telegramConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', chatId: '555', telegramUserId: '555' }),
      })
    )
    expect(prisma.telegramLinkToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tok-1' }, data: { consumedAt: expect.any(Date) } })
    )
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'user-1',
        type: 'account.telegram_linked',
        idempotencyKey: 'telegram.linked:conn-new',
      })
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'telegram.connection_linked', targetId: 'conn-new' })
    )
  })

  it('relink: cancels the old connection deliveries and deletes it before the new bind', async () => {
    lockToken({ id: 'tok-1', userId: 'user-1' })
    prisma.telegramConnection.findUnique
      .mockResolvedValueOnce(null) // owner by chatId (new chat)
      .mockResolvedValueOnce({ id: 'old-conn' } as never) // existing by userId

    await service.processUpdate(startBody())

    expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetRef: 'old-conn', channel: 'telegram' }),
        data: expect.objectContaining({ terminalReasonCode: 'telegram_connection_replaced' }),
      })
    )
    expect(prisma.telegramConnection.delete).toHaveBeenCalledWith({ where: { id: 'old-conn' } })
    expect(prisma.telegramConnection.create).toHaveBeenCalled()
  })

  it('translates a unique-race P2002 to a retryable 503 (not 409) without consuming the token', async () => {
    lockToken({ id: 'tok-1', userId: 'user-1' })
    prisma.telegramConnection.findUnique.mockResolvedValue(null)
    prisma.telegramConnection.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '7' })
    )

    await expect(service.processUpdate(startBody())).rejects.toMatchObject({ status: 503 })
    expect(prisma.telegramLinkToken.update).not.toHaveBeenCalled()
    expect(notifications.notify).not.toHaveBeenCalled()
  })

  it('keeps a committed bind even if the post-commit confirmation throws', async () => {
    lockToken({ id: 'tok-1', userId: 'user-1' })
    prisma.telegramConnection.findUnique.mockResolvedValue(null)
    notifications.notify.mockRejectedValue(new Error('queue down'))

    await expect(service.processUpdate(startBody())).resolves.toBeUndefined()
    expect(audit.record).toHaveBeenCalled() // audit still recorded after a failed confirmation
  })
})
