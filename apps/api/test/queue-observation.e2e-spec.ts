import { execSync } from 'node:child_process'

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { FlowProducer, Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'

import { QUEUE_INVENTORY } from '../src/infrastructure/queue/constants/queue-inventory.constant'
import type { QueueService } from '../src/infrastructure/queue/queue.service'
import { QueueObservationService } from '../src/infrastructure/queue/queue-observation.service'
import { buildBullConnection } from '../src/infrastructure/queue/redis-connection.config'

/**
 * Real BullMQ 6 + Redis, on this suite's OWN container (never the application's Redis):
 * the observation service reads plain keys, so every state is compared with BullMQ's own getters,
 * and the half-open/disconnect behaviour is proved with the actual ioredis client.
 */
const EMAIL = QUEUE_INVENTORY.find((queue) => queue.name === 'email')
if (!EMAIL) throw new Error('email descriptor missing')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('QueueObservationService against real Redis', () => {
  let container: StartedRedisContainer
  let queue: Queue
  let service: QueueObservationService
  let url: string

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start()
    url = container.getConnectionUrl()
    queue = new Queue('email', { connection: buildBullConnection(url), prefix: 'amcore' })
    queue.on('error', () => undefined)
    service = new QueueObservationService({ getQueue: () => queue } as unknown as QueueService)
    service.onModuleInit()
    await queue.waitUntilReady()
    await sleep(200)
  }, 120000)

  afterAll(async () => {
    await queue.close()
    await container.stop()
  }, 60000)

  beforeEach(async () => {
    await queue.obliterate({ force: true })
    await queue.resume()
  })

  /** The producer connection is ioredis; BullMQ's public client type omits generic commands. */
  const rawClient = async () => (await queue.getBackend().client) as unknown as Redis

  const observe = async () => {
    const [row] = await service.observe([EMAIL])
    if (row?.status !== 'available') throw new Error(`Expected available, got ${row?.status}`)
    return row
  }

  it('reads the same counts as BullMQ across waiting, prioritized, delayed, failed and paused', async () => {
    await queue.add('w', { a: 1 })
    await queue.add('w2', { a: 1 })
    await queue.add('p', { a: 1 }, { priority: 3 })
    await queue.add('d', { a: 1 }, { delay: 60_000 })
    await queue.pause()

    const row = await observe()
    const bull = await queue.getJobCounts('waiting', 'prioritized', 'delayed', 'active', 'failed')
    expect(row.counts).toMatchObject({
      waiting: bull.waiting,
      prioritized: bull.prioritized,
      delayed: bull.delayed,
      active: bull.active,
      failed: bull.failed,
    })
    expect(row.counts).toMatchObject({ waiting: 2, prioritized: 1, delayed: 1 })
    expect(row.paused).toBe(await queue.isPaused())
    expect(row.paused).toBe(true)
  })

  it('counts active and failed jobs and waiting children', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    const worker = new Worker(
      'email',
      async (job) => {
        if (job.name === 'fail') throw new Error('expected failure')
        await held
      },
      { connection: buildBullConnection(url), prefix: 'amcore' }
    )
    try {
      await queue.add('fail', {}, { attempts: 1 })
      await queue.add('hold', {})
      for (
        let i = 0;
        i < 50 && ((await queue.getJobCounts('active', 'failed')).failed ?? 0) < 1;
        i++
      ) {
        await sleep(100)
      }
      const row = await observe()
      const bull = await queue.getJobCounts('active', 'failed')
      expect(row.counts.active).toBe(bull.active)
      expect(row.counts.failed).toBe(bull.failed)
      expect(row.counts.failed).toBeGreaterThanOrEqual(1)
    } finally {
      release()
      await worker.close()
    }

    const flow = new FlowProducer({ connection: buildBullConnection(url), prefix: 'amcore' })
    try {
      await flow.add({
        name: 'parent',
        queueName: 'email',
        children: [{ name: 'child', queueName: 'email', opts: { delay: 60_000 } }],
      })
      const row = await observe()
      expect(row.counts.waitingChildren).toBe(
        (await queue.getJobCounts('waiting-children'))['waiting-children']
      )
      expect(row.counts.waitingChildren).toBe(1)
    } finally {
      await flow.close()
    }
  })

  it('reports none for an empty queue and a creation-based lower bound otherwise', async () => {
    expect((await observe()).age).toEqual({ status: 'none' })

    await queue.add('old', { big: 'x'.repeat(256 * 1024) }, { timestamp: Date.now() - 120_000 })
    await queue.add('new', { a: 1 })
    const row = await observe()
    expect(row.age).toMatchObject({ status: 'sample', sampled: 2 })
    expect(row.age.status === 'sample' ? row.age.seconds : 0).toBeGreaterThanOrEqual(119)
  })

  it('stays a lower bound when LIFO reorders the line, and covers prioritized jobs', async () => {
    await queue.add('first', {}, { timestamp: Date.now() - 300_000 })
    await queue.add('lifo', {}, { lifo: true })
    await queue.add('prio', {}, { priority: 2, timestamp: Date.now() - 600_000 })
    const row = await observe()
    expect(row.age.status).toBe('sample')
    // the oldest job is in `prioritized`; the sample covers both lists
    expect(row.age.status === 'sample' ? row.age.seconds : 0).toBeGreaterThanOrEqual(599)
  })

  it('reports unknown age when queued ids have no readable timestamp (vanished/invalid)', async () => {
    const client = await rawClient()
    await client.lpush(queue.toKey('wait'), 'ghost-1')
    const row = await observe()
    expect(row.counts.waiting).toBe(1)
    expect(row.age).toEqual({ status: 'unknown' })
  })

  it('reads a job laid out as raw keys exactly like a BullMQ-created one (browser fixture parity)', async () => {
    const client = await rawClient()
    const stamp = Date.now() - 45_000
    await client.lpush(queue.toKey('wait'), 'fixture-1')
    await client.hset(queue.toKey('fixture-1'), { name: 'fixture', data: '{}', timestamp: stamp })
    await client.hset(queue.toKey('meta'), { paused: 1 })
    const row = await observe()
    expect(row.paused).toBe(true)
    expect(row.counts.waiting).toBe(1)
    expect(row.age).toMatchObject({ status: 'sample', sampled: 1 })
  })

  it('performs no Redis writes while observing', async () => {
    await queue.add('w', {})
    const client = await rawClient()
    const before = await client.info('commandstats')
    await observe()
    const after = await client.info('commandstats')
    const writes = (text: string) =>
      text
        .split('\r\n')
        .filter((line) =>
          /^cmdstat_(set|hset|del|lpush|rpush|lpop|rpop|zadd|zrem|eval|evalsha|expire):/.test(line)
        )
        .join('|')
    expect(writes(after)).toBe(writes(before))
  })

  it('keeps Redis work constant through a blackhole and recovers afterwards', async () => {
    await queue.add('w', {})
    const client = await rawClient()
    const calls = async () => {
      const stats = await container.executeCliCmd('info', ['commandstats'])
      return Number(/cmdstat_llen:calls=(\d+)/.exec(stats)?.[1] ?? 0)
    }
    const baseline = await calls()
    const id = container.getId()
    execSync(`docker pause ${id}`)
    try {
      const statuses = new Set<string>()
      for (let i = 0; i < 8; i++) {
        statuses.add(((await service.observe([EMAIL]))[0] as { status: string }).status)
        await sleep(400)
      }
      expect(statuses).toEqual(new Set(['unavailable']))
      expect(client.status).toBe('ready') // half-open: only the deadline protects us
    } finally {
      execSync(`docker unpause ${id}`)
    }
    // exactly one unit (2 LLEN) reached Redis for 8 refreshes of the paused window
    await sleep(500)
    expect((await calls()) - baseline).toBe(2)
    expect((await observe()).counts.waiting).toBe(1)
  }, 60000)
})
