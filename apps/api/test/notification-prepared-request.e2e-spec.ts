import { jest } from '@jest/globals'
import { PinoLogger } from 'nestjs-pino'

import type { DeliveryContext } from '../src/core/notifications/channels/channel-deliverer.types'
import { NotificationChannelRegistry } from '../src/core/notifications/channels/notification-channel.registry'
import { preparedNotificationRequest } from '../src/core/notifications/channels/notification-prepared-request'
import { NotificationDeliveryRepository } from '../src/core/notifications/dispatch/notification-delivery.repository'
import { NotificationPreparedRequestService } from '../src/core/notifications/dispatch/notification-prepared-request.service'
import { NotificationShutdownLatch } from '../src/core/notifications/dispatch/notification-shutdown.latch'
import { NotificationsService } from '../src/core/notifications/notifications.service'
import { Prisma } from '../src/generated/prisma/client'

import {
  fixtureRecipient,
  setupNotificationExtensions,
} from './fixtures/extension-contracts/notification-context'
import { FixtureChannelDeliverer } from './fixtures/extension-contracts/notification-registration'
import { cleanDatabase, type E2ETestContext, teardownE2ETest } from './helpers'

/** Real row locks/CAS; this suite never calls a live provider. */
describe('Prepared notification request (PostgreSQL)', () => {
  let context: E2ETestContext
  let prepared: NotificationPreparedRequestService
  let deliveryContext: DeliveryContext
  beforeAll(async () => {
    context = await setupNotificationExtensions()
  }, 180000)
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
    const userId = await fixtureRecipient(context)
    const result = await context.app.get(NotificationsService).notify({
      recipientUserId: userId,
      type: 'extension.fixture',
      payload: { text: 'original' },
      idempotencyKey: 'extension.fixture:prepared',
    })
    await context.prisma.notificationDelivery.updateMany({
      where: { notificationId: result.notificationId, status: 'PENDING' },
      data: { availableAt: new Date(0) },
    })
    const latch = new NotificationShutdownLatch(context.app.get(PinoLogger))
    const repository = new NotificationDeliveryRepository(context.prisma, latch)
    const batch = await repository.claimDueBatch(1)
    if (typeof batch === 'symbol') throw new Error('fixture_claim_cutoff')
    if (batch.length !== 1) throw new Error(`fixture_claim_count:${batch.length}`)
    const [delivery] = batch
    const notification = await context.prisma.notification.findUniqueOrThrow({
      where: { id: result.notificationId },
    })
    deliveryContext = { delivery: delivery!, notification }
    prepared = new NotificationPreparedRequestService(
      context.prisma,
      context.app.get(NotificationChannelRegistry),
      latch
    )
  })

  const candidate = (text: string, destination = deliveryContext.delivery.targetKey) =>
    preparedNotificationRequest(
      deliveryContext,
      'fixture:default',
      '/deliver',
      JSON.stringify({ destination, text }),
      `notification-delivery:${deliveryContext.delivery.id}`
    )
  const obtain = (render: () => Promise<ReturnType<typeof candidate>>) =>
    prepared.obtain(
      deliveryContext,
      context.app.get(FixtureChannelDeliverer),
      'fixture:default',
      '/deliver',
      `notification-delivery:${deliveryContext.delivery.id}`,
      render
    )

  it('freezes a complete request before I/O and never renders again on retry', async () => {
    const first = await obtain(async () => candidate('first-render'))
    const secondRender = jest.fn(async () => candidate('changed-render'))
    expect(await obtain(secondRender)).toEqual(first)
    expect(secondRender).not.toHaveBeenCalled()
    const row = await context.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryContext.delivery.id },
    })
    expect(row.preparedRequestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(row.preparedRequest).toEqual(first)
    expect(FixtureChannelDeliverer.requests).toHaveLength(0)
  })

  it('concurrent preparation losers reuse the first committed complete request', async () => {
    let firstReady!: () => void
    let secondReady!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      firstReady = resolve
    })
    const secondStarted = new Promise<void>((resolve) => {
      secondReady = resolve
    })
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = obtain(async () => {
      firstReady()
      await barrier
      return candidate('first')
    })
    const second = obtain(async () => {
      secondReady()
      await barrier
      return candidate('second')
    })
    await Promise.all([firstStarted, secondStarted])
    release()
    const [left, right] = await Promise.all([first, second])
    expect(left).toEqual(right)
    const row = await context.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryContext.delivery.id },
    })
    expect(row.preparedRequest).toEqual(left)
    expect(FixtureChannelDeliverer.requests).toHaveLength(0)
  })

  it('loses snapshot admission when the claim lease expires', async () => {
    await context.prisma.notificationDelivery.update({
      where: { id: deliveryContext.delivery.id },
      data: { leaseExpiresAt: new Date(0) },
    })
    expect(await obtain(async () => candidate('expired'))).toEqual({
      status: 'not_started',
      reason: 'lease_expired',
    })
    const row = await context.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryContext.delivery.id },
    })
    expect(row.preparedRequest).toBeNull()
  })

  it('refuses body target substitution and corrupt/partial snapshots without transport', async () => {
    expect(await obtain(async () => candidate('wrong target', 'another-subscription'))).toEqual({
      status: 'permanent',
      errorCode: 'notification_prepared_request_invalid',
    })
    await obtain(async () => candidate('valid'))
    await context.prisma.notificationDelivery.update({
      where: { id: deliveryContext.delivery.id },
      data: { preparedRequestHash: '0'.repeat(64) },
    })
    expect(await obtain(async () => candidate('replacement'))).toEqual({
      status: 'permanent',
      errorCode: 'notification_prepared_request_invalid',
    })
    expect(FixtureChannelDeliverer.requests).toHaveLength(0)
  })

  it('prepares marker-v1 work reclaimed after a crash before snapshot despite prior attempts', async () => {
    const latch = new NotificationShutdownLatch(context.app.get(PinoLogger))
    const repository = new NotificationDeliveryRepository(context.prisma, latch)
    await context.prisma.notificationDelivery.update({
      where: { id: deliveryContext.delivery.id },
      data: { leaseExpiresAt: new Date(0) },
    })
    const reaped = await repository.reapExpiredLeases()
    expect(reaped).toMatchObject({ rescheduled: 1 })
    await context.prisma.notificationDelivery.update({
      where: { id: deliveryContext.delivery.id },
      data: { nextAttemptAt: new Date(0) },
    })
    await context.prisma.notificationDelivery.updateMany({
      where: {
        notificationId: deliveryContext.notification.id,
        id: { not: deliveryContext.delivery.id },
        status: 'PENDING',
      },
      data: { availableAt: new Date(Date.now() + 60000) },
    })
    const claimed = await repository.claimDueBatch(1)
    if (typeof claimed === 'symbol') throw new Error('fixture_claim_cutoff')
    expect(claimed).toHaveLength(1)
    deliveryContext = { ...deliveryContext, delivery: claimed[0]! }
    const row = await context.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryContext.delivery.id },
    })
    expect(row).toMatchObject({ requestContractVersion: 1, preparedRequest: null, attemptCount: 2 })
    expect(await obtain(async () => candidate('reclaimed'))).toMatchObject({
      body: JSON.stringify({ destination: row.targetKey, text: 'reclaimed' }),
    })
    const attempts = await context.prisma.notificationDeliveryAttempt.findMany({
      where: { deliveryId: row.id },
      orderBy: { attemptNumber: 'asc' },
    })
    expect(attempts[0]).toMatchObject({ outcome: 'ABANDONED' })
    expect(FixtureChannelDeliverer.requests).toHaveLength(0)
  })

  it.each([null, 99])('refuses active marker %s before preparation or I/O', async (marker) => {
    await context.prisma.notificationDelivery.update({
      where: { id: deliveryContext.delivery.id },
      data: { requestContractVersion: marker },
    })
    const render = jest.fn(async () => candidate('forbidden'))
    expect(await obtain(render)).toMatchObject({
      status: 'permanent',
      errorCode: 'legacy_delivery_outcome_unverified',
    })
    expect(render).not.toHaveBeenCalled()
    const send = jest.fn()
    expect(
      await context.app.get(FixtureChannelDeliverer).deliver(deliveryContext, { send } as never)
    ).toMatchObject({ status: 'permanent' })
    expect(send).not.toHaveBeenCalled()
    expect(FixtureChannelDeliverer.requests).toHaveLength(0)
  })

  it.each(['body', 'hash'] as const)(
    'refuses partial %s snapshot before preparation or I/O',
    async (part) => {
      await context.prisma.notificationDelivery.update({
        where: { id: deliveryContext.delivery.id },
        data:
          part === 'body'
            ? { preparedRequest: candidate('partial') as unknown as Prisma.InputJsonValue }
            : { preparedRequestHash: '0'.repeat(64) },
      })
      const render = jest.fn(async () => candidate('replacement'))
      expect(await obtain(render)).toMatchObject({
        status: 'permanent',
        errorCode: 'notification_prepared_request_invalid',
      })
      expect(render).not.toHaveBeenCalled()
      const send = jest.fn()
      expect(
        await context.app.get(FixtureChannelDeliverer).deliver(deliveryContext, { send } as never)
      ).toMatchObject({ status: 'permanent' })
      expect(send).not.toHaveBeenCalled()
      expect(FixtureChannelDeliverer.requests).toHaveLength(0)
    }
  )

  it('cancels a revoked generation before saving the snapshot', async () => {
    await context.prisma
      .$executeRaw`DELETE FROM core.extension_fixture_subscriptions WHERE id = ${deliveryContext.delivery.targetRef}`
    expect(await obtain(async () => candidate('revoked'))).toEqual({
      status: 'not_started',
      reason: 'target_revoked',
    })
    const row = await context.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryContext.delivery.id },
    })
    expect(row.status).toBe('CANCELLED')
    expect(row.preparedRequest).toBeNull()
  })
})
