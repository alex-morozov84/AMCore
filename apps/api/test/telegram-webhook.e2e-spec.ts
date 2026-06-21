import {
  createTgUser,
  issueTokenRow,
  postUpdate,
  resetTelegramE2E,
  seedPendingTelegramDelivery,
  setupTelegramE2E,
  startUpdate,
  teardownTelegramE2E,
  type TelegramE2E,
} from './telegram-e2e.helpers'

/**
 * Telegram inbound webhook merge gate (Arc D / D.7): secret auth, the atomic
 * receipt/consume/bind transaction, durable replay dedupe, the R6 same-chat race
 * **convergence**, and the R5 relink fence — against real Postgres.
 */
describe('Telegram webhook (e2e)', () => {
  let tg: TelegramE2E

  beforeAll(async () => {
    tg = await setupTelegramE2E()
  }, 120000)
  afterAll(async () => teardownTelegramE2E(tg), 120000)
  beforeEach(async () => resetTelegramE2E(tg))

  it('rejects a missing/invalid secret header with 401', async () => {
    const res = await postUpdate(tg.app, { update_id: 1 }, 'wrong').expect(401)
    expect(res.body.errorCode).toBe('WEBHOOK_SIGNATURE_INVALID')
  })

  it('binds a chat on a valid /start and consumes the token', async () => {
    const userId = await createTgUser(tg.prisma)
    const token = await issueTokenRow(tg.prisma, userId)
    await postUpdate(tg.app, startUpdate(100, 555, token)).expect(200)

    const conn = await tg.prisma.telegramConnection.findUnique({ where: { userId } })
    expect(conn).toMatchObject({ chatId: '555', telegramUserId: '555', status: 'ACTIVE' })
    const tokenRow = await tg.prisma.telegramLinkToken.findFirst({ where: { userId } })
    expect(tokenRow?.consumedAt).not.toBeNull()
  })

  it('is effect-once on a replayed update_id', async () => {
    const userId = await createTgUser(tg.prisma)
    await postUpdate(tg.app, startUpdate(200, 777, await issueTokenRow(tg.prisma, userId))).expect(
      200
    )
    // Replay the SAME update_id with a different valid token → durable no-op.
    await postUpdate(tg.app, startUpdate(200, 777, await issueTokenRow(tg.prisma, userId))).expect(
      200
    )

    expect(await tg.prisma.telegramConnection.count({ where: { userId } })).toBe(1)
    expect(
      await tg.prisma.telegramLinkToken.count({ where: { userId, consumedAt: { not: null } } })
    ).toBe(1)
  })

  it('rejects a foreign-owned chat without consuming the second token', async () => {
    const u1 = await createTgUser(tg.prisma)
    await postUpdate(tg.app, startUpdate(400, 999, await issueTokenRow(tg.prisma, u1))).expect(200)
    const u2 = await createTgUser(tg.prisma)
    const t2 = await issueTokenRow(tg.prisma, u2)
    await postUpdate(tg.app, startUpdate(401, 999, t2)).expect(200) // chat 999 owned by u1

    expect(await tg.prisma.telegramConnection.count({ where: { chatId: '999' } })).toBe(1)
    expect(await tg.prisma.telegramConnection.count({ where: { userId: u2 } })).toBe(0)
    expect(
      (await tg.prisma.telegramLinkToken.findFirstOrThrow({ where: { userId: u2 } })).consumedAt
    ).toBeNull()
  })

  it('R6: racing the same chat converges — one ACTIVE, one token spent, loser unconsumed', async () => {
    const u1 = await createTgUser(tg.prisma)
    const u2 = await createTgUser(tg.prisma)
    const upd1 = startUpdate(500, 1234, await issueTokenRow(tg.prisma, u1))
    const upd2 = startUpdate(501, 1234, await issueTokenRow(tg.prisma, u2))

    const first = await Promise.all([postUpdate(tg.app, upd1), postUpdate(tg.app, upd2)])
    for (const r of first) expect([200, 503]).toContain(r.status)
    expect(first.some((r) => r.status === 200)).toBe(true) // a winner committed

    // Convergence: Telegram retries any 503 with the SAME update — it must become a clean 200.
    if (first[0]!.status === 503) await postUpdate(tg.app, upd1).expect(200)
    if (first[1]!.status === 503) await postUpdate(tg.app, upd2).expect(200)

    expect(await tg.prisma.telegramConnection.count({ where: { chatId: '1234' } })).toBe(1)
    expect(await tg.prisma.telegramLinkToken.count({ where: { consumedAt: { not: null } } })).toBe(
      1
    )
    expect(
      await tg.prisma.telegramUpdateReceipt.count({ where: { updateId: { in: [500n, 501n] } } })
    ).toBe(2)
    const winner = await tg.prisma.telegramConnection.findFirstOrThrow({
      where: { chatId: '1234' },
    })
    const loserId = winner.userId === u1 ? u2 : u1
    expect(await tg.prisma.telegramConnection.count({ where: { userId: loserId } })).toBe(0)
    expect(
      (await tg.prisma.telegramLinkToken.findFirstOrThrow({ where: { userId: loserId } }))
        .consumedAt
    ).toBeNull()
  })

  it('R5: relink cancels the prior connection’s pending delivery before the new bind', async () => {
    const userId = await createTgUser(tg.prisma)
    await postUpdate(tg.app, startUpdate(600, 4321, await issueTokenRow(tg.prisma, userId))).expect(
      200
    )
    const oldConn = await tg.prisma.telegramConnection.findUniqueOrThrow({ where: { userId } })
    await seedPendingTelegramDelivery(tg.prisma, userId, oldConn.id, '4321')

    await postUpdate(tg.app, startUpdate(601, 8765, await issueTokenRow(tg.prisma, userId))).expect(
      200
    )

    const fresh = await tg.prisma.telegramConnection.findUniqueOrThrow({ where: { userId } })
    expect(fresh.chatId).toBe('8765')
    expect(fresh.id).not.toBe(oldConn.id) // new id = the D.5 generation fence
    const cancelled = await tg.prisma.notificationDelivery.findFirstOrThrow({
      where: { targetRef: oldConn.id },
    })
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.terminalReasonCode).toBe('telegram_connection_replaced')
  })
})
