import { SchedulerRegistry } from '@nestjs/schedule'

import { type E2ETestContext, setupE2ETest, teardownE2ETest } from '../../helpers'
import { closeManagedWorker } from '../background-work/close-managed-worker'

import { registerFixtureNotifications } from './notification-registration'

export async function setupNotificationExtensions(): Promise<E2ETestContext> {
  const context = await setupE2ETest(registerFixtureNotifications)
  try {
    for (const job of context.app.get(SchedulerRegistry, { strict: false }).getCronJobs().values())
      job.stop()
    await closeManagedWorker(context.app, 'notifications')
    await context.prisma.$executeRaw`
    CREATE TABLE core.extension_fixture_subscriptions (
      id text PRIMARY KEY, "userId" text NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      destination text NOT NULL
    )`
    return context
  } catch (error) {
    await teardownE2ETest(context)
    throw error
  }
}

export async function fixtureRecipient(context: E2ETestContext): Promise<string> {
  const email = `extension-${crypto.randomUUID()}@example.com`
  const user = await context.prisma.user.create({
    data: {
      email,
      emailCanonical: email,
      passwordHash: 'fixture',
      emailVerified: true,
    },
  })
  await context.prisma.$executeRaw`
    INSERT INTO core.extension_fixture_subscriptions (id, "userId", destination)
    VALUES (${`${user.id}-a`}, ${user.id}, 'subscription-a'),
           (${`${user.id}-b`}, ${user.id}, 'subscription-b')`
  return user.id
}
