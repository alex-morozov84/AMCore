import { once } from 'node:events'

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import { z } from 'zod'

import { parseManagedJob } from '../src/infrastructure/background-work/managed-job-profile'
import { ManagedProducer } from '../src/infrastructure/background-work/managed-producer'
import {
  defineOrdinaryWork,
  type JobBinding,
} from '../src/infrastructure/background-work/work-definition'
import { WorkExecutionService } from '../src/infrastructure/background-work/work-execution.service'
import { WorkReadiness } from '../src/infrastructure/background-work/work-readiness'
import { buildBullConnection } from '../src/infrastructure/queue/redis-connection.config'

const defaults = {
  wireVersion: 1,
  replay: { kind: 'idempotent' as const, policyVersion: 1 },
  retention: { completedMs: 3600000, failedMs: 86400000 },
}
const cases: {
  name: string
  binding: JobBinding
  input: unknown
  wire: unknown
  normalized: unknown
}[] = [
  {
    name: 'shape',
    binding: {
      ...defaults,
      schema: z.object({ source: z.string() }),
      normalize: (wire: { source: string }) => ({ destination: wire.source }),
      project: (payload: { destination: string }) => payload,
    },
    input: { source: 'wire', secret: 'stripped' },
    wire: { source: 'wire' },
    normalized: { destination: 'wire' },
  },
  {
    name: 'increment',
    binding: {
      ...defaults,
      schema: z.object({ value: z.number() }),
      normalize: (wire: { value: number }) => ({ value: wire.value + 1 }),
      project: (payload: { value: number }) => payload,
    },
    input: { value: 1 },
    wire: { value: 1 },
    normalized: { value: 2 },
  },
  {
    name: 'nested',
    binding: {
      ...defaults,
      schema: z.object({ nested: z.object({ value: z.number() }) }),
      normalize: (wire: { nested: { value: number } }) => ({ value: wire.nested.value }),
      project: (payload: { value: number }) => payload,
    },
    input: { nested: { value: 3, secret: 'removed' }, extra: 4 },
    wire: { nested: { value: 3 } },
    normalized: { value: 3 },
  },
  {
    name: 'union',
    binding: {
      ...defaults,
      schema: z.union([z.object({ a: z.number() }), z.object({ b: z.number() })]),
      normalize: (wire: { a: number } | { b: number }) => ({
        value: 'a' in wire ? wire.a : wire.b,
      }),
      project: (payload: { value: number }) => payload,
    },
    input: { b: 4, secret: 'removed' },
    wire: { b: 4 },
    normalized: { value: 4 },
  },
  {
    name: 'preprocess',
    binding: {
      ...defaults,
      schema: z.object({ raw: z.string() }),
      normalize: (wire: { raw: string }) =>
        z.preprocess((value) => Number((value as { raw: string }).raw), z.number()).parse(wire),
      project: (payload: number) => ({ value: payload }),
    },
    input: { raw: '5' },
    wire: { raw: '5' },
    normalized: 5,
  },
  {
    name: 'passthrough',
    binding: {
      ...defaults,
      schema: z.object({ value: z.number() }).passthrough(),
      project: (payload: { value: number }) => ({ value: payload.value }),
    },
    input: { value: 6, allowed: 'kept' },
    wire: { value: 6, allowed: 'kept' },
    normalized: { value: 6, allowed: 'kept' },
  },
]

describe('Actual managed wire → BullMQ → worker/projection', () => {
  let container: StartedRedisContainer
  let queue: Queue
  let redis: Redis
  const readiness = new WorkReadiness()
  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start()
    queue = new Queue('payload', {
      prefix: 'amcore',
      connection: buildBullConnection(container.getConnectionUrl()),
    })
    queue.on('error', () => undefined)
    redis = (await queue.getBackend().client) as unknown as Redis
    readiness.open()
  }, 120000)
  beforeEach(async () => {
    await redis.flushdb()
  })
  afterAll(async () => {
    await queue?.close()
    await container?.stop()
  })

  it.each(cases)(
    '$name preserves canonical wire and delivers normalized payload',
    async ({ name, binding, input, wire, normalized }) => {
      const definition = defineOrdinaryWork({
        id: 'payload',
        definitionVersion: 1,
        queue: { name: 'payload', enabled: true },
        jobs: { [name]: binding },
      })
      const producer = new ManagedProducer(definition, queue, readiness)
      const identity = await producer.add(name, input, { jobId: 'immutable' })
      const fields = await redis.hgetall(queue.toKey(identity.jobId))
      expect(JSON.parse(fields.data!).payload).toEqual(wire)
      const profile = parseManagedJob(definition, fields)
      expect(profile.payload).toEqual(normalized)
      expect(profile.binding.project(profile.payload)).toEqual(binding.project(normalized))
      expect(await producer.add(name, input, { jobId: 'immutable' })).toEqual(identity)
      const duplicate =
        name === 'shape'
          ? await producer.add(name, { source: 'replacement' }, { jobId: 'immutable' })
          : identity
      expect(duplicate).toEqual(identity)
      expect(await redis.hget(queue.toKey(identity.jobId), 'data')).toBe(fields.data)
      const received: unknown[] = []
      const execution = new WorkExecutionService(readiness)
      const worker = new Worker(
        'payload',
        (job, token) =>
          execution.run(definition, queue, job, token!, {
            run: async (payload) => {
              received.push(payload)
            },
          }),
        {
          prefix: 'amcore',
          connection: buildBullConnection(container.getConnectionUrl()),
          autorun: false,
        }
      )
      worker.on('error', () => undefined)
      try {
        await worker.waitUntilReady()
        const completed = once(worker, 'completed')
        void worker.run().catch(() => undefined)
        await completed
        expect(received).toEqual([normalized])
        expect(
          JSON.parse((await redis.hget(queue.toKey(identity.jobId), 'data'))!).payload
        ).toEqual(wire)
      } finally {
        await worker.close()
      }
    }
  )

  it('checks full-envelope 32KiB Unicode/escaping limits before Redis writes', async () => {
    const definition = defineOrdinaryWork({
      id: 'payload',
      definitionVersion: 1,
      queue: { name: 'payload', enabled: true },
      jobs: { run: { ...defaults, schema: z.string(), project: () => ({}) } },
    })
    const producer = new ManagedProducer(definition, queue, readiness)
    const overhead = Buffer.byteLength(
      JSON.stringify({
        protocolVersion: 1,
        incarnation: '0'.repeat(36),
        jobVersion: 1,
        executionPolicyVersion: 1,
        createdAt: Date.now(),
        payload: '',
      })
    )
    const payload = 'x'.repeat(32768 - overhead)
    await producer.add('run', payload, { jobId: 'boundary' })
    expect(Buffer.byteLength((await redis.hget(queue.toKey('boundary'), 'data'))!)).toBe(32768)
    await redis.flushdb()
    for (const value of [
      payload + 'x',
      'я'.repeat(Math.ceil(payload.length / 2)),
      '"'.repeat(Math.ceil(payload.length / 2)),
    ]) {
      await expect(producer.add('run', value)).rejects.toThrow('CONTENT_UNSUPPORTED')
      expect(await redis.dbsize()).toBe(0)
    }
  })

  it('refuses strict extras, unstable wire and invalid normalizers without writes', async () => {
    const variants: JobBinding[] = [
      { ...defaults, schema: z.strictObject({ value: z.number() }), project: () => ({}) },
      {
        ...defaults,
        schema: z.object({ value: z.number() }).transform((value) => ({ value: value.value + 1 })),
        project: () => ({}),
      },
      ...[
        () => {
          throw new Error('failed')
        },
        (wire: { value: number }) => {
          wire.value++
          return wire
        },
        async () => ({}),
      ].map((normalize) => ({
        ...defaults,
        schema: z.object({ value: z.number() }),
        normalize,
        project: () => ({}),
      })),
    ]
    for (const binding of variants) {
      const definition = defineOrdinaryWork({
        id: 'payload',
        definitionVersion: 1,
        queue: { name: 'payload', enabled: true },
        jobs: { run: binding },
      })
      await expect(
        new ManagedProducer(definition, queue, readiness).add('run', { value: 1, extra: 1 })
      ).rejects.toThrow()
      expect(await redis.dbsize()).toBe(0)
    }
  })

  it.each(['jobVersion', 'executionPolicyVersion'])(
    'refuses unsupported %s on projection and actual worker',
    async (field) => {
      const definition = defineOrdinaryWork({
        id: 'payload',
        definitionVersion: 1,
        queue: { name: 'payload', enabled: true },
        jobs: {
          run: {
            ...defaults,
            schema: z.object({ value: z.number() }),
            project: ({ value }) => ({ value }),
          },
        },
      })
      const identity = await new ManagedProducer(definition, queue, readiness).add('run', {
        value: 1,
      })
      const key = queue.toKey(identity.jobId)
      const stored = JSON.parse((await redis.hget(key, 'data'))!)
      await redis.hset(key, 'data', JSON.stringify({ ...stored, [field]: 999 }))
      const fields = await redis.hgetall(key)
      expect(() => parseManagedJob(definition, fields)).toThrow('VERSION_UNSUPPORTED')
      const received: unknown[] = []
      const execution = new WorkExecutionService(readiness)
      const worker = new Worker(
        'payload',
        (job, token) =>
          execution.run(definition, queue, job, token!, {
            run: async (payload) => {
              received.push(payload)
            },
          }),
        {
          prefix: 'amcore',
          connection: buildBullConnection(container.getConnectionUrl()),
          autorun: false,
        }
      )
      worker.on('error', () => undefined)
      try {
        await worker.waitUntilReady()
        const failed = once(worker, 'failed')
        void worker.run().catch(() => undefined)
        const [, error] = await failed
        expect(error.message).toBe('VERSION_UNSUPPORTED')
        expect(received).toEqual([])
      } finally {
        await worker.close()
      }
    }
  )
})
