import { ModulesContainer } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { ChannelDelivererRegistry } from '../src/core/notifications/channels/channel-deliverer.registry'
import { NotificationDispatchGate } from '../src/core/notifications/dispatch/notification-dispatch.gate'
import { NotificationShutdownLatch } from '../src/core/notifications/dispatch/notification-shutdown.latch'
import { NotificationDefinitionRegistry } from '../src/core/notifications/notification-definition.registry'
import { NotificationsService } from '../src/core/notifications/notifications.service'
import { AiToolContractRegistry } from '../src/infrastructure/ai/tools/ai-tool-contract.registry'
import { AiToolRegistry } from '../src/infrastructure/ai/tools/ai-tool-registry.service'

import {
  fixtureRecipient,
  setupNotificationExtensions,
} from './fixtures/extension-contracts/notification-context'
import {
  FixtureChannelDeliverer,
  registerFixtureNotifications,
} from './fixtures/extension-contracts/notification-registration'
import { cleanDatabase, type E2ETestContext, noopPinoLogger, teardownE2ETest } from './helpers'

/** Compile documented composition, inspect real Nest providers, then resolve transaction-local targets. */
describe('Downstream extension module registration', () => {
  let context: E2ETestContext
  beforeAll(async () => {
    context = await setupNotificationExtensions()
  }, 180000)
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
  })

  it('shares one configured registry, worker latch and dispatch gate across consumers', () => {
    const modules = context.app.get(ModulesContainer)
    for (const token of [
      NotificationDefinitionRegistry,
      NotificationShutdownLatch,
      NotificationDispatchGate,
      AiToolContractRegistry,
    ]) {
      const instances = new Set(
        [...modules.values()].flatMap((module) => {
          const wrapper = module.providers.get(token)
          return wrapper?.instance ? [wrapper.instance] : []
        })
      )
      expect(instances.size).toBe(1)
    }
  })

  it('registers a custom reader/deliverer without changing enums or resolving through the base client', async () => {
    const userId = await fixtureRecipient(context)
    const producer = context.app.get(NotificationsService)
    const result = await context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO core.extension_fixture_subscriptions (id, "userId", destination)
        VALUES ('transaction-only', ${userId}, 'subscription-c')`
      return producer.notifyTx(tx, {
        recipientUserId: userId,
        type: 'extension.fixture',
        payload: { text: 'transaction-aware' },
        idempotencyKey: 'extension.fixture:registration',
      })
    })
    const targets = await context.prisma.notificationDelivery.findMany({
      where: {
        notificationId: result.notificationId,
        channel: 'fixture_channel',
      },
    })
    expect(targets.map((row) => row.targetKey).sort()).toEqual([
      'subscription-a',
      'subscription-b',
      'subscription-c',
    ])
    expect(context.app.get(ChannelDelivererRegistry).get('fixture_channel')).toBeInstanceOf(
      FixtureChannelDeliverer
    )
    expect(context.app.get(NotificationDefinitionRegistry).capabilities().channels).toContain(
      'fixture_channel'
    )
  })

  it('keeps transport and AI executors out of web DI while exposing producer and contract authority', async () => {
    const { WebModule } = await import('../src/web.module')
    const builder = Test.createTestingModule({ imports: [WebModule] })
      .overrideProvider(PinoLogger)
      .useValue(noopPinoLogger)
    const web = await registerFixtureNotifications(builder).compile()
    try {
      expect(web.get(NotificationsService)).toBeDefined()
      expect(web.get(AiToolContractRegistry)).toBeDefined()
      expect(() => web.get(FixtureChannelDeliverer)).toThrow()
      expect(() => web.get(ChannelDelivererRegistry)).toThrow()
      expect(() => web.get(AiToolRegistry)).toThrow()
      expect(() => web.get(NotificationShutdownLatch)).toThrow()
    } finally {
      await web.close()
    }
  })
})
