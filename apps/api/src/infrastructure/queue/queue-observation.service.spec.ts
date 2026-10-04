import type { Queue } from 'bullmq'

import type { QueueDescriptor } from './constants/queue-inventory.constant'
import type { QueueService } from './queue.service'
import { QUEUE_OBSERVATION_DEADLINE_MS, QueueObservationService } from './queue-observation.service'

type Reply = [Error | null, unknown]
interface PendingExec {
  commands: unknown[][]
  resolve: (replies: Reply[] | null) => void
  reject: (error: Error) => void
}

/** Controllable stand-in for the resolved ioredis client: every pipeline is held until the test settles it. */
function fakeClient(status = 'ready') {
  const execs: PendingExec[] = []
  const client = {
    status,
    pipeline() {
      const commands: unknown[][] = []
      const chain = new Proxy(
        {},
        {
          get: (_target, name: string) => {
            if (name === 'exec') {
              return () =>
                new Promise<Reply[] | null>((resolve, reject) => {
                  execs.push({ commands, resolve, reject })
                })
            }
            if (!['llen', 'zcard', 'zrange', 'lrange', 'hexists', 'hget'].includes(name)) {
              throw new Error(`Forbidden Redis command: ${name}`)
            }
            return (...args: unknown[]) => {
              commands.push([name, ...args])
              return chain
            }
          },
        }
      )
      return chain
    },
  }
  return { client, execs }
}

const descriptor = (name: string, enabled = true): QueueDescriptor =>
  ({ name, kind: 'work', enabled }) as QueueDescriptor

function setup(names: string[] = ['email']) {
  const clients = new Map(names.map((name) => [name, fakeClient()]))
  const queues = new Map(
    names.map((name) => [
      name,
      {
        toKey: (type: string) => `amcore:${name}:${type}`,
        getBackend: () => ({ client: Promise.resolve(clients.get(name)?.client) }),
      } as unknown as Queue,
    ])
  )
  const service = new QueueObservationService({
    getQueue: (name: string) => queues.get(name),
  } as unknown as QueueService)
  return { service, clients, queues }
}

const ok = (value: unknown): Reply => [null, value]
function stageA(over: Partial<Record<string, unknown>> = {}): Reply[] {
  const v: Record<string, unknown> = {
    wait: 2,
    prio: 1,
    delayed: 3,
    active: 4,
    failed: 5,
    children: 6,
    paused: 0,
    ...over,
  }
  return [
    ok(v.wait),
    ok(v.prio),
    ok(v.delayed),
    ok(v.active),
    ok(v.failed),
    ok(v.children),
    ok(v.paused),
    ok(v.waitIds ?? ['1', '2']),
    ok(v.prioIds ?? ['9']),
  ]
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('QueueObservationService', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-03T12:00:00.000Z') }))
  afterEach(() => jest.useRealTimers())

  async function ready(names?: string[]) {
    const env = setup(names)
    env.service.onModuleInit()
    await flush()
    return env
  }

  it('reports disabled queues without any lookup or Redis read', async () => {
    const { service, clients } = await ready()
    const [row] = await service.observe([descriptor('email', false)])
    expect(row).toEqual({ name: 'email', kind: 'work', status: 'disabled' })
    expect(clients.get('email')?.execs).toHaveLength(0)
  })

  it('is unavailable with zero commands before the client resolved (cold start)', async () => {
    const { service, clients } = setup() // onModuleInit never ran: no retained handle
    expect(await service.observe([descriptor('email')])).toEqual([
      { name: 'email', kind: 'work', status: 'unavailable' },
    ])
    expect(clients.get('email')?.execs).toHaveLength(0)
  })

  it('is unavailable with zero commands while the client is not ready', async () => {
    const { service, clients } = await ready()
    const fake = clients.get('email')
    if (!fake) throw new Error('missing fake')
    fake.client.status = 'reconnecting'
    expect((await service.observe([descriptor('email')]))[0]?.status).toBe('unavailable')
    expect(fake.execs).toHaveLength(0)
  })

  it('reads counts, pause flag and a timestamp-only age sample', async () => {
    const { service, clients } = await ready()
    const pending = service.observe([descriptor('email')])
    await flush()
    const fake = clients.get('email')
    const first = fake?.execs[0]
    expect(first?.commands.map((c) => c[0])).toEqual([
      'llen',
      'zcard',
      'zcard',
      'llen',
      'zcard',
      'zcard',
      'hexists',
      'lrange',
      'zrange',
    ])
    first?.resolve(stageA({ paused: 1 }))
    await flush()
    const second = fake?.execs[1]
    expect(second?.commands).toEqual([
      ['hget', 'amcore:email:1', 'timestamp'],
      ['hget', 'amcore:email:2', 'timestamp'],
      ['hget', 'amcore:email:9', 'timestamp'],
    ])
    const now = Date.now()
    second?.resolve([ok(String(now - 90_000)), ok(String(now - 5_000)), ok(String(now - 30_000))])
    const [row] = await pending
    expect(row).toEqual({
      name: 'email',
      kind: 'work',
      status: 'available',
      sampledAt: '2026-10-03T12:00:00.000Z',
      paused: true,
      counts: { waiting: 2, prioritized: 1, delayed: 3, active: 4, failed: 5, waitingChildren: 6 },
      age: { status: 'sample', seconds: 90, sampled: 3 },
    })
  })

  it('reports no age and reads no timestamps when nothing is queued', async () => {
    const { service, clients } = await ready()
    const pending = service.observe([descriptor('email')])
    await flush()
    clients.get('email')?.execs[0]?.resolve(stageA({ wait: 0, prio: 0, waitIds: [], prioIds: [] }))
    const [row] = await pending
    expect(row).toMatchObject({ status: 'available', age: { status: 'none' } })
    expect(clients.get('email')?.execs).toHaveLength(1)
  })

  it.each([
    ['missing/zero', [ok(null), ok('0')]],
    ['non-numeric', [ok('abc'), ok('NaN')]],
    ['future', [ok(String(Date.now() + 60_000)), ok(String(Date.now() + 1))]],
    [
      'per-command error',
      [
        [new Error('x'), null],
        [new Error('y'), null],
      ] as Reply[],
    ],
  ])('keeps counts and reports unknown age for %s timestamps', async (_label, replies) => {
    const { service, clients } = await ready()
    const pending = service.observe([descriptor('email')])
    await flush()
    clients.get('email')?.execs[0]?.resolve(stageA({ waitIds: ['1', '2'], prioIds: [] }))
    await flush()
    clients.get('email')?.execs[1]?.resolve(replies as Reply[])
    const [row] = await pending
    expect(row).toMatchObject({ status: 'available', age: { status: 'unknown' } })
  })

  it('keeps valid counts with unknown age when only the age stage fails', async () => {
    const { service, clients } = await ready()
    const pending = service.observe([descriptor('email')])
    await flush()
    clients.get('email')?.execs[0]?.resolve(stageA())
    await flush()
    clients.get('email')?.execs[1]?.reject(new Error('boom'))
    expect((await pending)[0]).toMatchObject({ status: 'available', age: { status: 'unknown' } })
  })

  it('keeps valid counts with unknown age when the age stage is slow, and never replaces the unit', async () => {
    const { service, clients } = await ready()
    const pending = service.observe([descriptor('email')])
    await flush()
    clients.get('email')?.execs[0]?.resolve(stageA())
    await flush()
    await jest.advanceTimersByTimeAsync(QUEUE_OBSERVATION_DEADLINE_MS)
    expect((await pending)[0]).toMatchObject({ status: 'available', age: { status: 'unknown' } })
    expect((await service.observe([descriptor('email')]))[0]?.status).toBe('unavailable')
    expect(clients.get('email')?.execs).toHaveLength(2) // stage A + the held stage B only
  })

  it('treats a failing or malformed counts stage as unavailable, never as zeros', async () => {
    for (const replies of [
      [[new Error('x'), null], ...stageA().slice(1)] as Reply[],
      stageA({ wait: -1 }),
      stageA({ wait: 1.5 }),
      stageA({ wait: 'many' }),
      stageA().slice(0, 8),
    ]) {
      const { service, clients } = await ready()
      const pending = service.observe([descriptor('email')])
      await flush()
      clients.get('email')?.execs[0]?.resolve(replies)
      expect((await pending)[0]).toEqual({ name: 'email', kind: 'work', status: 'unavailable' })
    }
  })

  it('bounds actual Redis work across many refreshes while a read never settles', async () => {
    const { service, clients } = await ready()
    const fake = clients.get('email')
    const rows: string[] = []
    for (let i = 0; i < 100; i++) {
      const pending = service.observe([descriptor('email')])
      await jest.advanceTimersByTimeAsync(i === 0 ? QUEUE_OBSERVATION_DEADLINE_MS : 30_000)
      rows.push(((await pending)[0] as { status: string }).status)
    }
    expect(new Set(rows)).toEqual(new Set(['unavailable']))
    expect(fake?.execs).toHaveLength(1) // one unit, never replaced across 100 calls / 49 minutes
    expect(jest.getTimerCount()).toBe(0) // no waiter timers left behind
  })

  it('discards a late counts reply: no age stage and no fresh snapshot', async () => {
    const { service, clients } = await ready()
    const fake = clients.get('email')
    const pending = service.observe([descriptor('email')])
    await jest.advanceTimersByTimeAsync(QUEUE_OBSERVATION_DEADLINE_MS)
    expect((await pending)[0]?.status).toBe('unavailable')
    fake?.execs[0]?.resolve(stageA())
    await flush()
    expect(fake?.execs).toHaveLength(1) // Stage B was never started
    // the slot is free only after the real settlement
    const next = service.observe([descriptor('email')])
    await flush()
    expect(fake?.execs).toHaveLength(2)
    fake?.execs[1]?.resolve(stageA({ wait: 0, prio: 0, waitIds: [], prioIds: [] }))
    expect((await next)[0]).toMatchObject({ status: 'available', age: { status: 'none' } })
  })

  it('frees the slot when the read really fails, then recovers on the next call', async () => {
    const { service, clients } = await ready()
    const fake = clients.get('email')
    const pending = service.observe([descriptor('email')])
    await flush()
    fake?.execs[0]?.reject(new Error('Connection is closed'))
    expect((await pending)[0]?.status).toBe('unavailable')
    const next = service.observe([descriptor('email')])
    await flush()
    expect(fake?.execs).toHaveLength(2)
    fake?.execs[1]?.resolve(stageA({ wait: 0, prio: 0, waitIds: [], prioIds: [] }))
    expect((await next)[0]?.status).toBe('available')
  })

  it('shares one unit between concurrent callers and keeps queues independent', async () => {
    const { service, clients } = await ready(['email', 'notifications'])
    const inventory = [descriptor('email'), descriptor('notifications')]
    const a = service.observe(inventory)
    const b = service.observe(inventory)
    await flush()
    expect(clients.get('email')?.execs).toHaveLength(1)
    expect(clients.get('notifications')?.execs).toHaveLength(1)
    clients.get('email')?.execs[0]?.resolve(stageA({ wait: 0, prio: 0, waitIds: [], prioIds: [] }))
    await jest.advanceTimersByTimeAsync(QUEUE_OBSERVATION_DEADLINE_MS) // notifications never answers
    for (const rows of await Promise.all([a, b])) {
      expect(rows.map((row) => row.status)).toEqual(['available', 'unavailable'])
    }
  })

  it('exposes only whitelisted fields and issues only read commands', async () => {
    const { service, clients } = await ready()
    const pending = service.observe([descriptor('email')])
    await flush()
    clients.get('email')?.execs[0]?.resolve(stageA({ waitIds: ['secret-id'], prioIds: [] }))
    await flush()
    clients.get('email')?.execs[1]?.resolve([ok(String(Date.now() - 1000))])
    const [row] = await pending
    expect(JSON.stringify(row)).not.toContain('secret-id')
    expect(Object.keys(row as object).sort()).toEqual(
      ['age', 'counts', 'kind', 'name', 'paused', 'sampledAt', 'status'].sort()
    )
  })
})
