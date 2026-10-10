import { once } from 'node:events'

import type { WorkerHost } from '@nestjs/bullmq'
import { DiscoveryService } from '@nestjs/core'

import { BACKGROUND_WORK } from '../src/background-work.composition'
import { ControlConnection } from '../src/infrastructure/background-work/control-connection'
import { ManagedProducer } from '../src/infrastructure/background-work/managed-producer'
import { ProviderEvidenceStore } from '../src/infrastructure/background-work/provider-evidence.store'
import {
  MANAGED_WORKERS,
  type ManagedWorkerBinding,
} from '../src/infrastructure/background-work/work-coordinator'
import { WorkReadiness } from '../src/infrastructure/background-work/work-readiness'
import { EmailTemplate } from '../src/infrastructure/email/email.types'
import { emailWork } from '../src/infrastructure/email/email.work'
import { JobName } from '../src/infrastructure/queue/constants/queues.constant'
import { QueueService } from '../src/infrastructure/queue/queue.service'

import { type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

describe('Single-registration runtime — full isolated application startup', () => {
  let context: E2ETestContext
  beforeAll(async () => {
    // No remote provider is contacted. The real mock port deduplicates across Redis connections.
    process.env.EMAIL_PROVIDER = 'mock'
    context = await setupE2ETest()
  }, 120_000)
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 60_000)

  it('opens readiness only with exactly the generated running worker set', () => {
    expect(
      context.app
        .get(DiscoveryService)
        .getProviders()
        .filter(({ instance }) => instance instanceof ControlConnection)
    ).toHaveLength(1)
    expect(context.app.get(WorkReadiness, { strict: false }).isReady).toBe(true)
    const bindings = context.app.get<readonly ManagedWorkerBinding[]>(MANAGED_WORKERS, {
      strict: false,
    })
    expect(bindings.map(({ workId }) => workId).sort()).toEqual([
      'ai-runs',
      'email',
      'notifications',
    ])
    for (const binding of bindings) {
      const host = context.app.get<WorkerHost>(binding.host, { strict: false })
      expect(host.worker.isRunning()).toBe(true)
      expect(host.worker.opts.autorun).toBe(false)
    }
    const queues = context.app.get(QueueService, { strict: false })
    for (const { definition } of BACKGROUND_WORK.filter(
      ({ definition }) => definition.queue?.enabled
    )) {
      expect(queues.getQueue(definition.queue!.name)?.name).toBe(definition.queue!.name)
    }
  })

  it('resolves the registered producer and completes actual immutable queued email through shared policy', async () => {
    const producer = context.app.get<ManagedProducer<typeof emailWork>>(emailWork.tokens.producer, {
      strict: false,
    })
    const binding = context.app
      .get<readonly ManagedWorkerBinding[]>(MANAGED_WORKERS, { strict: false })
      .find(({ workId }) => workId === emailWork.id)!
    const host = context.app.get<WorkerHost>(binding.host, { strict: false })
    const completed = once(host.worker, 'completed')
    const identity = await producer.add(
      JobName.SEND_EMAIL,
      {
        template: EmailTemplate.WELCOME,
        to: 'fixture@example.test',
        data: { name: 'Fixture', email: 'fixture@example.test' },
      },
      { jobId: 'startup-email', attempts: 2 }
    )
    await completed
    expect(
      await context.app
        .get(ProviderEvidenceStore, { strict: false })
        .read(emailWork.id, identity.incarnation)
    ).toMatchObject({
      certainty: 'accepted',
      unresolvedCount: 0,
      outcomeRecorded: true,
      autoStartsUsed: 1,
    })
  })
})
