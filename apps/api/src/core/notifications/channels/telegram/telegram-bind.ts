import { createHash } from 'node:crypto'

import { HttpStatus } from '@nestjs/common'

import { NotificationChannel } from '../../notification.constants'

import { TelegramCancelReason } from './telegram.constants'
import type { TelegramStartCommand } from './telegram-update.schema'

import { AppException } from '@/common/exceptions'
import { NotificationDeliveryStatus, Prisma } from '@/generated/prisma/client'

/** A successful bind, signalled to the post-commit confirmation/audit step. */
export interface BindResult {
  userId: string
  connectionId: string
}

interface LockedToken {
  id: string
  userId: string
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * The ordered bind mutations inside ONE transaction (R1–R6) — the token is consumed ONLY on a fully
 * successful bind. Returns the bind, or `null` for a durable no-op (replay / non-`/start` / unknown
 * token / foreign chat — all commit the receipt + ack 200, none consume the token). A transient/
 * race failure throws (the caller's tx rolls back → 5xx).
 */
export async function bindFromUpdate(
  tx: Prisma.TransactionClient,
  updateId: bigint,
  command: TelegramStartCommand | null
): Promise<BindResult | null> {
  // a. Durable dedupe: no insert → replay → commit, no effect.
  if (!(await insertReceipt(tx, updateId))) return null
  // b. No `/start` match → durable no-op (receipt committed, token untouched).
  if (!command) return null
  // c+d. Lock the token, then reject a foreign-owned chat WITHOUT consuming it (R2).
  const token = await lockEligibleToken(tx, command)
  if (!token) return null
  // e+f+g. Relink fence → new-id insert → consume the token LAST.
  return commitBind(tx, token, command)
}

/** Insert the `update_id` receipt; false → a row already existed (replay). */
async function insertReceipt(tx: Prisma.TransactionClient, updateId: bigint): Promise<boolean> {
  const { count } = await tx.telegramUpdateReceipt.createMany({
    data: [{ updateId }],
    skipDuplicates: true,
  })
  return count > 0
}

/** Lock an unconsumed/unexpired token, then gate on foreign-chat ownership (read before mutation). */
async function lockEligibleToken(
  tx: Prisma.TransactionClient,
  command: TelegramStartCommand
): Promise<LockedToken | null> {
  const token = await lockToken(tx, command.token)
  if (!token) return null
  const owner = await tx.telegramConnection.findUnique({
    where: { chatId: command.chatId },
    select: { userId: true },
  })
  if (owner && owner.userId !== token.userId) return null // never silently move a chat; token kept
  return token
}

/** Relink-fence the owner's old connection, insert the new-id row, then consume the token last. */
async function commitBind(
  tx: Prisma.TransactionClient,
  token: LockedToken,
  command: TelegramStartCommand
): Promise<BindResult> {
  await replaceOwnerConnection(tx, token.userId)
  const connection = await insertConnection(tx, token.userId, command)
  await tx.telegramLinkToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } })
  return { userId: token.userId, connectionId: connection.id }
}

/** `SELECT … FOR UPDATE` the unconsumed/unexpired token row by hash (a read — never burns it). */
async function lockToken(
  tx: Prisma.TransactionClient,
  rawToken: string
): Promise<LockedToken | null> {
  const rows = await tx.$queryRaw<LockedToken[]>(Prisma.sql`
    SELECT id, "userId" FROM "notifications"."telegram_link_tokens"
    WHERE "tokenHash" = ${hashToken(rawToken)}
      AND "consumedAt" IS NULL
      AND "expiresAt" > now()
    FOR UPDATE
  `)
  return rows[0] ?? null
}

/** Cancel + delete the user's existing connection (relink = unlink-fence + bind, R5). */
async function replaceOwnerConnection(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const existing = await tx.telegramConnection.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!existing) return
  await tx.notificationDelivery.updateMany({
    where: {
      targetRef: existing.id,
      channel: NotificationChannel.TELEGRAM,
      status: {
        in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.RETRY_SCHEDULED],
      },
    },
    data: {
      status: NotificationDeliveryStatus.CANCELLED,
      terminalReasonCode: TelegramCancelReason.CONNECTION_REPLACED,
    },
  })
  await tx.telegramConnection.delete({ where: { id: existing.id } })
}

/**
 * Insert the fresh `ACTIVE` connection. A unique-constraint race (`P2002`) is translated to a
 * bounded **503** so Telegram retries — NOT the global `PrismaClientExceptionFilter`'s 409, which
 * would tell Telegram to stop. No constraint/identity detail is leaked (R6).
 */
async function insertConnection(
  tx: Prisma.TransactionClient,
  userId: string,
  command: TelegramStartCommand
): Promise<{ id: string }> {
  try {
    return await tx.telegramConnection.create({
      data: { userId, chatId: command.chatId, telegramUserId: command.telegramUserId },
      select: { id: true },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppException(
        'Webhook processing conflict, retry',
        HttpStatus.SERVICE_UNAVAILABLE,
        'telegram_webhook_retry'
      )
    }
    throw err
  }
}
