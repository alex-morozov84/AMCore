import { createHash } from 'node:crypto'
import { once } from 'node:events'

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import { v7 as uuidv7 } from 'uuid'

import {
  readBoundedJob,
  readBoundedJobPage,
} from '../src/infrastructure/background-work/bounded-job-reader'
import { readJobSnapshot } from '../src/infrastructure/background-work/job-snapshot'
import { preparedBody } from '../src/infrastructure/background-work/prepared-body.store'
import { readQueueSnapshot } from '../src/infrastructure/background-work/queue-snapshot'
import {
  applyIdempotentCommand,
  applyProviderWindowCommand,
} from '../src/infrastructure/background-work/scripts/idempotent-command'
import { startIdempotentInvocation } from '../src/infrastructure/background-work/scripts/idempotent-start'
import { reportManagedInvocation } from '../src/infrastructure/background-work/scripts/invocation-report'
import { deferProviderCooldown } from '../src/infrastructure/background-work/scripts/provider-defer'
import { PROVIDER_FENCE_LUA } from '../src/infrastructure/background-work/scripts/provider-fence.lua'
import { applyQueueControl } from '../src/infrastructure/background-work/scripts/queue-control'
import { buildBullConnection } from '../src/infrastructure/queue/redis-connection.config'

describe('Managed queue pause/resume — real BullMQ/Redis', () => {
  let container: StartedRedisContainer
  let queue: Queue
  let redis: Redis
  let revision: number
  const epoch = uuidv7()
  const prefix = 'amcore:pause-proof:'

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start()
    queue = new Queue('pause-proof', {
      prefix: 'amcore',
      connection: buildBullConnection(container.getConnectionUrl()),
    })
    queue.on('error', () => undefined)
    redis = (await queue.getBackend().client) as unknown as Redis
  }, 120_000)

  beforeEach(async () => {
    // This isolated database includes intentional corrupt-layout fixtures.
    await redis.flushdb()
    revision = 0
    await redis.hset(
      `${prefix}meta`,
      'amQueueEpoch',
      epoch,
      'amControlRevision',
      '0',
      'amProtocol',
      '1',
      'opts.maxLenEvents',
      '10000'
    )
  })

  afterAll(async () => {
    await queue?.close()
    await container?.stop()
  }, 60_000)

  async function control(operation: 'pause' | 'resume', paused: boolean) {
    const result = await applyQueueControl(redis, {
      prefix,
      epoch,
      revision,
      nextRevision: revision + 1,
      paused,
      operation,
      admittedAt: Date.now(),
      dispatchNotAfter: Date.now() + 5000,
    })
    if (result.status === 'applied') revision = result.revision
    return result
  }

  async function preparedCleanup() {
    const incarnation = await managedPending()
    const key = `${prefix}managed-job`
    await redis.set(`${key}:lock`, 'preparer', 'PX', 10000)
    const prepared = await preparedBody(
      redis,
      queue,
      'managed-job',
      {
        incarnation,
        lockToken: 'preparer',
        providerScope: 'a'.repeat(64),
      },
      'private frozen request'
    )
    expect(prepared.status).toBe('prepared')
    await redis.del(`${key}:lock`)
    await redis.lrem(`${prefix}wait`, 1, 'managed-job')
    await redis.zadd(`${prefix}completed`, Date.now() - 10000, 'managed-job')
    await redis.hset(key, 'finishedOn', String(Date.now() - 10000))
    return { key, incarnation, bodyKey: `${key}:am-request:${incarnation}` }
  }

  async function cleanupRequest(incarnation: string) {
    const snapshot = await readJobSnapshot(redis, queue, 'managed-job')
    if (snapshot.status !== 'observed') throw new Error('Expected snapshot')
    return {
      id: 'managed-job',
      incarnation,
      fingerprint: snapshot.snapshot.fingerprint,
      operation: 'cleanup' as const,
      wireVersion: 1,
      policyVersion: 1,
      admittedAt: Date.now(),
      dispatchNotAfter: Date.now() + 5000,
      commandId: uuidv7(),
      dispatchId: uuidv7(),
      cleanup: { cutoff: Date.now() - 5000, minimumAgeMs: 1, state: 'completed' as const },
    }
  }

  const cleanupEvidence = {
    revision: 1,
    digest: null,
    scope: null,
    nominalDeadline: null,
    floorUpper: 0,
  }
  const preparedBase = `${prefix}am:prepared:`

  it('provider cleanup releases the matching body reservation exactly once', async () => {
    const { incarnation, bodyKey } = await preparedCleanup()
    const command = await cleanupRequest(incarnation)
    expect(await applyProviderWindowCommand(redis, queue, command, cleanupEvidence, true)).toEqual({
      status: 'applied',
    })
    expect(await redis.exists(bodyKey)).toBe(1)
    expect(await applyProviderWindowCommand(redis, queue, command, cleanupEvidence)).toEqual({
      status: 'applied',
    })
    expect(await redis.exists(bodyKey)).toBe(0)
    expect(await redis.hgetall(`${preparedBase}account`)).toEqual({ count: '0', bytes: '0' })
    expect(await redis.zcard(`${preparedBase}expiry`)).toBe(0)
    expect(await redis.hlen(`${preparedBase}sizes`)).toBe(0)
    expect(await applyProviderWindowCommand(redis, queue, command, cleanupEvidence)).toEqual({
      status: 'rejected',
      reason: 'HISTORY_EXPIRED',
    })
    expect(await redis.hgetall(`${preparedBase}account`)).toEqual({ count: '0', bytes: '0' })
    // A new incarnation can consume the released capacity immediately.
    const replacement = await managedPending()
    await redis.set(`${prefix}managed-job:lock`, 'preparer', 'PX', 10000)
    expect(
      (
        await preparedBody(
          redis,
          queue,
          'managed-job',
          {
            incarnation: replacement,
            lockToken: 'preparer',
            providerScope: 'a'.repeat(64),
          },
          'replacement request'
        )
      ).status
    ).toBe('prepared')
    const before = await redis.hgetall(`${preparedBase}account`)
    expect(await applyProviderWindowCommand(redis, queue, command, cleanupEvidence)).toMatchObject({
      status: 'rejected',
    })
    expect(await redis.hgetall(`${preparedBase}account`)).toEqual(before)
    expect(await redis.exists(`${prefix}managed-job:am-request:${replacement}`)).toBe(1)
  })

  it('provider cleanup restores a saturated prepared quota without waiting for expiry', async () => {
    const { incarnation } = await preparedCleanup()
    async function reserve(id: string) {
      const identity = uuidv7()
      const job = `${prefix}${id}`
      await redis.hset(job, 'data', JSON.stringify({ protocolVersion: 1, incarnation: identity }))
      await redis.set(`${job}:lock`, 'quota-worker', 'PX', 10000)
      return preparedBody(
        redis,
        queue,
        id,
        {
          incarnation: identity,
          lockToken: 'quota-worker',
          providerScope: 'a'.repeat(64),
        },
        'x'
      )
    }
    for (let i = 0; i < 1023; i++) expect((await reserve(`quota-${i}`)).status).toBe('prepared')
    expect(await reserve('quota-refused')).toEqual({
      status: 'unavailable',
      reason: 'STORAGE_LIMIT',
    })
    expect(await redis.hget(`${preparedBase}account`, 'count')).toBe('1024')
    expect(
      await applyProviderWindowCommand(
        redis,
        queue,
        await cleanupRequest(incarnation),
        cleanupEvidence
      )
    ).toEqual({ status: 'applied' })
    expect(await redis.hget(`${preparedBase}account`, 'count')).toBe('1023')
    expect((await reserve('quota-admitted')).status).toBe('prepared')
    expect(await redis.hget(`${preparedBase}account`, 'count')).toBe('1024')
  })

  it.each(['count', 'bytes', 'sizes-type', 'unknown'])(
    'provider cleanup refuses %s before any write',
    async (corruption) => {
      const { key, incarnation, bodyKey } = await preparedCleanup()
      if (corruption === 'count') await redis.hset(`${preparedBase}account`, 'count', '2')
      if (corruption === 'bytes') await redis.hset(`${preparedBase}account`, 'bytes', '0')
      if (corruption === 'sizes-type') {
        await redis.del(`${preparedBase}sizes`)
        await redis.set(`${preparedBase}sizes`, 'wrong-type')
      }
      if (corruption === 'unknown') await redis.hset(key, 'amLegacyRequestUnknown', '1')
      const command = await cleanupRequest(incarnation)
      const keys = [
        key,
        bodyKey,
        `${preparedBase}account`,
        `${preparedBase}expiry`,
        `${preparedBase}sizes`,
        `${prefix}completed`,
        `${prefix}events`,
      ]
      const before = await Promise.all(keys.map((value) => redis.dumpBuffer(value)))
      expect(await applyProviderWindowCommand(redis, queue, command, cleanupEvidence)).toEqual({
        status: 'rejected',
        reason: corruption === 'unknown' ? 'EFFECT_UNKNOWN' : 'CONTENT_UNSUPPORTED',
      })
      expect(await Promise.all(keys.map((value) => redis.dumpBuffer(value)))).toEqual(before)
    }
  )

  it.each([5000, 10000])(
    'resumes actual claims after paused producer adds %i jobs',
    async (count) => {
      expect(await control('pause', false)).toMatchObject({ status: 'applied', paused: true })
      for (let offset = 0; offset < count; offset += 1000) {
        await queue.addBulk(
          Array.from({ length: 1000 }, (_, index) => ({
            name: 'work',
            data: {},
            opts: { jobId: `job-${offset + index}` },
          }))
        )
      }
      expect(await redis.llen(`${prefix}wait`)).toBe(count)
      expect(await redis.exists(`${prefix}paused`)).toBe(0)
      let claims = 0
      let markClaimed!: () => void
      const claimed = new Promise<void>((resolve) => {
        markClaimed = resolve
      })
      const workers = [0, 1].map(
        () =>
          new Worker(
            'pause-proof',
            async () => {
              claims += 1
              markClaimed()
            },
            { prefix: 'amcore', connection: buildBullConnection(container.getConnectionUrl()) }
          )
      )
      try {
        await Promise.all(workers.map((worker) => worker.waitUntilReady()))
        expect(claims).toBe(0)
        expect(await control('resume', true)).toMatchObject({ status: 'applied', paused: false })
        await claimed
        expect(claims).toBeGreaterThan(0)
        expect(await redis.hget(`${prefix}meta`, 'paused')).toBeNull()
      } finally {
        await Promise.all(workers.map((worker) => worker.close()))
      }
    }
  )

  it('pauses an already-large wait/active layout without scanning either list', async () => {
    const ids = Array.from({ length: 5000 }, (_, index) => `id-${index}`)
    await redis.rpush(`${prefix}wait`, ...ids)
    await redis.rpush(`${prefix}active`, ...ids)
    expect(await control('pause', false)).toMatchObject({ status: 'applied' })
    expect(await redis.llen(`${prefix}wait`)).toBe(5000)
    expect(await redis.llen(`${prefix}active`)).toBe(5000)
  })

  it('keeps queue CAS stable under enqueue while observing a backlog above job-command limits', async () => {
    const before = await readQueueSnapshot(redis, prefix)
    expect(before.status).toBe('observed')
    await redis.rpush(`${prefix}wait`, ...Array.from({ length: 10000 }, (_, i) => `job-${i}`))
    const after = await readQueueSnapshot(redis, prefix)
    if (before.status !== 'observed' || after.status !== 'observed')
      throw new Error('Expected snapshot')
    expect(after.snapshot.counts[0]).toBe(10000)
    expect(after.snapshot.revision).toBe(before.snapshot.revision)
    expect(await control('pause', false)).toMatchObject({ status: 'applied' })
    const paused = await readQueueSnapshot(redis, prefix)
    expect(paused.status === 'observed' && paused.snapshot.revision).not.toBe(
      before.snapshot.revision
    )
  })

  async function managedPending() {
    const incarnation = uuidv7()
    await queue.add(
      'work',
      {
        protocolVersion: 1,
        incarnation,
        jobVersion: 1,
        executionPolicyVersion: 1,
        createdAt: Date.now(),
        payload: {},
      },
      { jobId: 'managed-job', attempts: 3 }
    )
    return incarnation
  }

  it('refuses job membership proof above 4096, including a target beyond the checked window', async () => {
    await managedPending()
    await redis.lpush(`${prefix}wait`, ...Array.from({ length: 4096 }, (_, i) => `other-${i}`))
    expect(await readJobSnapshot(redis, queue, 'managed-job')).toEqual({
      status: 'unavailable',
      reason: 'LIMIT_REACHED',
    })
    expect(await redis.llen(`${prefix}wait`)).toBe(4097)
  })

  it('rejects duplicate and contradictory primary membership without guessing a state', async () => {
    await managedPending()
    await redis.rpush(`${prefix}wait`, 'managed-job')
    expect(await readJobSnapshot(redis, queue, 'managed-job')).toEqual({
      status: 'unavailable',
      reason: 'INCONSISTENT_STATE',
    })
    await redis.lrem(`${prefix}wait`, 1, 'managed-job')
    await redis.zadd(`${prefix}failed`, Date.now(), 'managed-job')
    expect(await readJobSnapshot(redis, queue, 'managed-job')).toEqual({
      status: 'unavailable',
      reason: 'INCONSISTENT_STATE',
    })
  })

  it('cancels only the exact unstarted incarnation and rejects replay before writes', async () => {
    const incarnation = await managedPending()
    const observed = await readJobSnapshot(redis, queue, 'managed-job')
    if (observed.status !== 'observed') throw new Error('Expected snapshot')
    const request = {
      id: 'managed-job',
      fingerprint: observed.snapshot.fingerprint,
      operation: 'cancel' as const,
      incarnation,
      wireVersion: 1,
      policyVersion: 1,
      admittedAt: Date.now(),
      dispatchNotAfter: Date.now() + 5000,
      commandId: uuidv7(),
      dispatchId: uuidv7(),
    }
    expect(await applyIdempotentCommand(redis, queue, request)).toEqual({ status: 'applied' })
    expect(await queue.getJob('managed-job')).toBeUndefined()
    expect(await redis.llen(`${prefix}wait`)).toBe(0)
    const before = await redis.dumpBuffer(`${prefix}events`)
    expect(await applyIdempotentCommand(redis, queue, request)).toEqual({
      status: 'rejected',
      reason: 'HISTORY_EXPIRED',
    })
    expect(await redis.dumpBuffer(`${prefix}events`)).toEqual(before)
  })

  it.each(['PERMANENT_FAILURE', 'TRANSIENT_FAILURE'])(
    'classifies %s from Bull failure even when the AM report was lost',
    async (failure) => {
      const incarnation = await managedPending()
      const key = `${prefix}managed-job`
      await redis.lrem(`${prefix}wait`, 1, 'managed-job')
      await redis.zadd(`${prefix}failed`, Date.now(), 'managed-job')
      await redis.hset(
        key,
        'amIncarnation',
        incarnation,
        'amManualGrant',
        'none',
        'amMetadata',
        JSON.stringify({ report: 'unrecorded' }),
        'failedReason',
        failure
      )
      const observed = await readJobSnapshot(redis, queue, 'managed-job')
      if (observed.status !== 'observed') throw new Error('Expected snapshot')
      const input = {
        id: 'managed-job',
        fingerprint: observed.snapshot.fingerprint,
        operation: 'retry' as const,
        incarnation,
        wireVersion: 1,
        policyVersion: 1,
        admittedAt: Date.now(),
        dispatchNotAfter: Date.now() + 5000,
        commandId: uuidv7(),
        dispatchId: uuidv7(),
      }
      const before = await Promise.all([
        redis.dumpBuffer(key),
        redis.dumpBuffer(`${prefix}failed`),
        redis.dumpBuffer(`${prefix}events`),
      ])
      const result = await applyIdempotentCommand(redis, queue, input)
      const permanent = failure === 'PERMANENT_FAILURE'
      expect(result).toEqual(
        permanent ? { status: 'rejected', reason: 'PERMANENT_FAILURE' } : { status: 'applied' }
      )
      const witness = permanent
        ? await Promise.all([
            redis.dumpBuffer(key),
            redis.dumpBuffer(`${prefix}failed`),
            redis.dumpBuffer(`${prefix}events`),
          ])
        : await redis.hget(key, 'amManualGrant')
      expect(witness).toEqual(permanent ? before : 'reserved')
    }
  )

  it('CAS rejects a changed safe failure witness without granting a manual entry', async () => {
    const incarnation = await managedPending()
    const key = `${prefix}managed-job`
    await redis.lrem(`${prefix}wait`, 1, 'managed-job')
    await redis.zadd(`${prefix}failed`, Date.now(), 'managed-job')
    await redis.hset(
      key,
      'amIncarnation',
      incarnation,
      'amManualGrant',
      'none',
      'amMetadata',
      JSON.stringify({ report: 'unrecorded' }),
      'failedReason',
      'TRANSIENT_FAILURE'
    )
    const observed = await readJobSnapshot(redis, queue, 'managed-job')
    if (observed.status !== 'observed') throw new Error('Expected snapshot')
    await redis.hset(key, 'failedReason', 'PERMANENT_FAILURE')
    expect(
      await applyIdempotentCommand(redis, queue, {
        id: 'managed-job',
        fingerprint: observed.snapshot.fingerprint,
        operation: 'retry',
        incarnation,
        wireVersion: 1,
        policyVersion: 1,
        admittedAt: Date.now(),
        dispatchNotAfter: Date.now() + 5000,
        commandId: uuidv7(),
        dispatchId: uuidv7(),
      })
    ).toEqual({ status: 'rejected', reason: 'STATE_CHANGED' })
    expect(await redis.hget(key, 'amManualGrant')).toBe('none')
    expect(await redis.llen(`${prefix}wait`)).toBe(0)
  })

  it('rejects stale cancellation after membership/lock/start changed with no mutation', async () => {
    const incarnation = await managedPending()
    const observed = await readJobSnapshot(redis, queue, 'managed-job')
    if (observed.status !== 'observed') throw new Error('Expected snapshot')
    await redis.lrem(`${prefix}wait`, 1, 'managed-job')
    await redis.lpush(`${prefix}active`, 'managed-job')
    await redis.set(`${prefix}managed-job:lock`, 'worker', 'PX', 30000)
    const keys = [`${prefix}managed-job`, `${prefix}active`, `${prefix}events`]
    const before = await Promise.all(keys.map((key) => redis.dumpBuffer(key)))
    expect(
      await applyIdempotentCommand(redis, queue, {
        id: 'managed-job',
        fingerprint: observed.snapshot.fingerprint,
        operation: 'cancel',
        incarnation,
        wireVersion: 1,
        policyVersion: 1,
        admittedAt: Date.now(),
        dispatchNotAfter: Date.now() + 5000,
        commandId: uuidv7(),
        dispatchId: uuidv7(),
      })
    ).toEqual({ status: 'rejected', reason: 'STATE_CHANGED' })
    expect(await Promise.all(keys.map((key) => redis.dumpBuffer(key)))).toEqual(before)
  })

  async function bodyFixture() {
    const incarnation = await managedPending()
    await redis.set(`${prefix}managed-job:lock`, 'worker', 'PX', 30000)
    return { incarnation, lockToken: 'worker', providerScope: 'a'.repeat(64) }
  }

  it('freezes exact bytes once and returns the original request on duplicate preparation', async () => {
    const input = await bodyFixture()
    expect(await preparedBody(redis, queue, 'managed-job', input)).toEqual({ status: 'missing' })
    const first = await preparedBody(redis, queue, 'managed-job', input, '{"request":"first"}')
    expect(first.status).toBe('prepared')
    expect(
      await preparedBody(redis, queue, 'managed-job', input, '{"request":"rerendered"}')
    ).toEqual(first)
    expect(await redis.hget(`${prefix}am:prepared:account`, 'count')).toBe('1')
    expect(await redis.hget(`${prefix}managed-job`, 'amRequestPrepared')).toBe('1')
  })

  it('never recreates an expired/missing frozen body or decrements TTL accounting implicitly', async () => {
    const input = await bodyFixture()
    await preparedBody(redis, queue, 'managed-job', input, '{"request":"first"}')
    await redis.del(`${prefix}managed-job:am-request:${input.incarnation}`)
    const before = await redis.dumpBuffer(`${prefix}am:prepared:account`)
    expect(await preparedBody(redis, queue, 'managed-job', input, '{"request":"new"}')).toEqual({
      status: 'unavailable',
      reason: 'REQUEST_EXPIRED',
    })
    expect(await redis.dumpBuffer(`${prefix}am:prepared:account`)).toEqual(before)
  })

  it('refuses a changed provider scope without modifying the frozen request', async () => {
    const input = await bodyFixture()
    await preparedBody(redis, queue, 'managed-job', input, '{"request":"first"}')
    expect(
      await preparedBody(redis, queue, 'managed-job', { ...input, providerScope: 'b'.repeat(64) })
    ).toEqual({ status: 'unavailable', reason: 'PROVIDER_CHANGED' })
    expect(await redis.get(`${prefix}managed-job:am-request:${input.incarnation}`)).toBe(
      '{"request":"first"}'
    )
  })

  it('reclaims at most 64 expired reservations atomically before admitting a new body', async () => {
    const input = await bodyFixture()
    const base = `${prefix}am:prepared:`
    const expiredAt = Date.now() - 1000
    const entries = Array.from({ length: 1024 }, () => uuidv7())
    await redis.hset(`${base}account`, 'count', 1024, 'bytes', 1024 * 128)
    await redis.zadd(`${base}expiry`, ...entries.flatMap((id) => [expiredAt, id]))
    await redis.hset(
      `${base}sizes`,
      ...entries.flatMap((id) => [
        id,
        JSON.stringify({
          size: 128,
          expires: expiredAt,
          digest: 'a'.repeat(64),
          scope: input.providerScope,
          jobId: 'expired-job',
        }),
      ])
    )
    const body = '{"request":"first"}'
    expect((await preparedBody(redis, queue, 'managed-job', input, body)).status).toBe('prepared')
    expect(await redis.zcard(`${base}expiry`)).toBe(961)
    expect(await redis.hget(`${base}account`, 'bytes')).toBe(
      String(960 * 128 + Buffer.byteLength(body))
    )
  })

  it('rejects body byte quota before expiry/account/job writes', async () => {
    const input = await bodyFixture()
    const base = `${prefix}am:prepared:`
    const expires = Date.now() + 10000
    const entries = Array.from({ length: 512 }, () => uuidv7())
    await redis.hset(`${base}account`, 'count', 512, 'bytes', 64 * 1024 * 1024)
    await redis.zadd(`${base}expiry`, ...entries.flatMap((id) => [expires, id]))
    await redis.hset(
      `${base}sizes`,
      ...entries.flatMap((id) => [
        id,
        JSON.stringify({
          size: 131072,
          expires,
          digest: 'a'.repeat(64),
          scope: input.providerScope,
          jobId: 'other-job',
        }),
      ])
    )
    // Hash reads may advance Redis's incremental dictionary rehash: RDB byte order is not logical state.
    const jobFields = (await redis.hkeys(`${prefix}managed-job`)).sort()
    expect(jobFields.length).toBeLessThanOrEqual(64)
    const snapshot = () =>
      Promise.all([
        redis.hmget(`${base}account`, 'count', 'bytes'),
        redis.zrange(`${base}expiry`, '0', '511', 'WITHSCORES'),
        redis.hmget(`${base}sizes`, ...entries),
        redis.hlen(`${base}sizes`),
        redis.hkeys(`${prefix}managed-job`).then((fields) => fields.sort()),
        redis.hmget(`${prefix}managed-job`, ...jobFields),
      ])
    const before = await snapshot()
    expect(await preparedBody(redis, queue, 'managed-job', input, '{"request":"first"}')).toEqual({
      status: 'unavailable',
      reason: 'STORAGE_LIMIT',
    })
    expect(await snapshot()).toEqual(before)
  })

  it.each([4097, 7001, 10000])(
    'renames the entire source-only legacy list of %i once',
    async (count) => {
      const ids = Array.from({ length: count }, (_, index) => `legacy-${index}`)
      await redis.hset(`${prefix}meta`, 'paused', '1')
      await redis.rpush(`${prefix}paused`, ...ids)
      expect(await control('resume', true)).toMatchObject({ status: 'applied' })
      expect(await redis.lrange(`${prefix}wait`, 0, -1)).toEqual(ids)
      expect(await redis.exists(`${prefix}paused`)).toBe(0)
    }
  )

  it.each(['pause', 'resume'] as const)(
    'refuses mixed legacy %s before any write',
    async (operation) => {
      await redis.hset(`${prefix}meta`, 'paused', '1')
      await redis.rpush(`${prefix}paused`, 'old')
      await redis.rpush(`${prefix}wait`, 'new')
      const keys = ['meta', 'wait', 'paused', 'marker', 'events'].map((name) => prefix + name)
      const before = await Promise.all(keys.map((key) => redis.dumpBuffer(key)))
      expect(await control(operation, true)).toEqual({
        status: 'rejected',
        code: 'LEGACY_MIGRATION_REQUIRED',
      })
      expect(await Promise.all(keys.map((key) => redis.dumpBuffer(key)))).toEqual(before)
    }
  )

  it('rejects stale revision and corrupt marker without writes', async () => {
    await redis.hset(`${prefix}meta`, 'amControlRevision', '2')
    expect(await control('pause', false)).toEqual({ status: 'rejected', code: 'STATE_CHANGED' })
    await redis.hset(`${prefix}meta`, 'amControlRevision', '0')
    await redis.zadd(`${prefix}marker`, 0, 'unexpected')
    expect(await control('pause', false)).toEqual({
      status: 'rejected',
      code: 'CONTENT_UNSUPPORTED',
    })
    expect(await redis.hget(`${prefix}meta`, 'paused')).toBeNull()
    expect(await redis.xlen(`${prefix}events`)).toBe(0)
  })

  it('allows active completion while concurrent producers remain paused, then resumes claims', async () => {
    let firstClaimed!: () => void
    let nextClaimed!: () => void
    let finishActive!: () => void
    const first = new Promise<void>((resolve) => {
      firstClaimed = resolve
    })
    const next = new Promise<void>((resolve) => {
      nextClaimed = resolve
    })
    const finish = new Promise<void>((resolve) => {
      finishActive = resolve
    })
    let claims = 0
    const worker = new Worker(
      'pause-proof',
      async () => {
        claims += 1
        if (claims === 1) {
          firstClaimed()
          await finish
        } else nextClaimed()
      },
      { prefix: 'amcore', connection: buildBullConnection(container.getConnectionUrl()) }
    )
    try {
      await queue.add('work', {}, { jobId: 'already-active' })
      await first
      expect(await control('pause', false)).toMatchObject({ status: 'applied' })
      await Promise.all(
        [0, 1].map((producer) =>
          queue.addBulk(
            Array.from({ length: 2500 }, (_, i) => ({
              name: 'work',
              data: {},
              opts: { jobId: `producer-${producer}-${i}` },
            }))
          )
        )
      )
      const completed = once(worker, 'completed')
      finishActive()
      await completed
      expect(claims).toBe(1)
      expect(await redis.zscore(`${prefix}completed`, 'already-active')).not.toBeNull()
      expect(await control('resume', true)).toMatchObject({ status: 'applied' })
      await next
    } finally {
      finishActive()
      await worker.close()
    }
  })

  it('restores priority/delayed markers and emits each state event once despite replay', async () => {
    await control('pause', false)
    await queue.add('work', {}, { jobId: 'priority-job', priority: 2 })
    expect(await control('resume', true)).toMatchObject({ status: 'applied' })
    expect(await redis.zscore(`${prefix}marker`, '0')).toBe('0')
    const eventsBefore = await redis.xlen(`${prefix}events`)
    expect(await control('resume', false)).toEqual({ status: 'rejected', code: 'ALREADY_IN_STATE' })
    expect(await redis.xlen(`${prefix}events`)).toBe(eventsBefore)
    await redis.del(`${prefix}prioritized`, `${prefix}marker`)
    await control('pause', false)
    await queue.add('work', {}, { jobId: 'delayed-job', delay: 60000 })
    await control('resume', true)
    const score = Number(await redis.zscore(`${prefix}delayed`, 'delayed-job'))
    expect(Number(await redis.zscore(`${prefix}marker`, '1'))).toBe(score / 4096)
    const events = await redis.xrange(`${prefix}events`, '-', '+')
    expect(events.filter(([, fields]) => fields.includes('paused'))).toHaveLength(2)
    expect(events.filter(([, fields]) => fields.includes('resumed'))).toHaveLength(2)
  })

  it('bounds hash reads and page bytes without returning an oversized field', async () => {
    const key = `${prefix}bounded`
    await redis.hset(key, 'data', 'x'.repeat(32769))
    expect(await readBoundedJob(redis, key)).toEqual({
      status: 'unavailable',
      reason: 'CONTENT_UNSUPPORTED',
    })
    const keys = Array.from({ length: 20 }, (_, i) => `${prefix}bounded-${i}`)
    await Promise.all(
      keys.map((jobKey) =>
        redis.hset(
          jobKey,
          'data',
          'x'.repeat(32768),
          'opts',
          'x'.repeat(16384),
          'amHistory',
          'x'.repeat(8192)
        )
      )
    )
    const page = await readBoundedJobPage(redis, keys)
    expect(page.truncated).toBe(true)
    expect(
      page.jobs.reduce((total, job) => total + (job.status === 'observed' ? job.bytes : 0), 0)
    ).toBeLessThanOrEqual(512 * 1024)
  })

  it('consumes finite automatic/manual starts and rejects a stale lock report', async () => {
    const key = `${prefix}managed`
    const incarnation = uuidv7()
    const base = {
      incarnation,
      policyVersion: 1,
      wireVersion: 1,
      lockToken: 'worker-1',
      dataFingerprint: '',
      optionsFingerprint: '',
    }
    await redis.hset(
      key,
      'data',
      JSON.stringify({
        protocolVersion: 1,
        incarnation,
        executionPolicyVersion: 1,
        jobVersion: 1,
        createdAt: Date.now(),
        payload: {},
      }),
      'opts',
      JSON.stringify({ attempts: 2 }),
      'ats',
      '1',
      'atm',
      '0'
    )
    base.dataFingerprint = createHash('sha1')
      .update((await redis.hget(key, 'data'))!)
      .digest('hex')
    base.optionsFingerprint = createHash('sha1')
      .update((await redis.hget(key, 'opts'))!)
      .digest('hex')
    await redis.set(`${key}:lock`, base.lockToken, 'PX', 30000)
    const first = await startIdempotentInvocation(redis, key, { ...base, revision: 0 })
    expect(first.status).toBe('started')
    const second = await startIdempotentInvocation(redis, key, { ...base, revision: 1 })
    expect(second.status).toBe('started')
    expect(await startIdempotentInvocation(redis, key, { ...base, revision: 2 })).toEqual({
      status: 'rejected',
      reason: 'AUTOMATIC_BUDGET_SPENT',
    })
    const manualIdentity = { manualCommandId: uuidv7(), manualDispatchId: uuidv7() }
    await redis.hset(
      key,
      'amManualGrant',
      'reserved',
      'amMode',
      'manual',
      'amManualCommandId',
      manualIdentity.manualCommandId,
      'amManualDispatchId',
      manualIdentity.manualDispatchId
    )
    const manual = await startIdempotentInvocation(redis, key, {
      ...base,
      ...manualIdentity,
      revision: 2,
    })
    expect(manual.status).toBe('started')
    expect(await startIdempotentInvocation(redis, key, { ...base, revision: 3 })).toEqual({
      status: 'rejected',
      reason: 'MANUAL_GRANT_SPENT',
    })
    if (manual.status !== 'started') throw new Error('Expected managed start')
    await redis.set(`${key}:lock`, 'worker-2', 'PX', 30000)
    expect(
      await reportManagedInvocation(redis, key, {
        incarnation,
        lockToken: base.lockToken,
        invocationId: manual.invocationId,
        revision: manual.revision,
        report: 'success',
        code: 'COMPLETED',
      })
    ).toEqual({ recorded: false, reason: 'STATE_CHANGED' })
    expect(JSON.parse((await redis.hget(key, 'amMetadata'))!).report).toBe('unrecorded')
  })
  it('defers a claimed cooldown without spending execution or removing a stale lock', async () => {
    const incarnation = uuidv7()
    const id = 'cooldown-job'
    const key = queue.toKey(id)
    await queue.add(
      'send-email',
      {
        protocolVersion: 1,
        incarnation,
        jobVersion: 1,
        executionPolicyVersion: 1,
        createdAt: Date.now(),
        payload: {},
      },
      { jobId: id, attempts: 3 }
    )
    await redis.lrem(queue.toKey('wait'), 1, id)
    await redis.lpush(queue.toKey('active'), id)
    await redis.hset(
      key,
      'ats',
      '1',
      'atm',
      '0',
      'amAutoStartsUsed',
      '1',
      'amManualGrant',
      'reserved',
      'amRevision',
      '4'
    )
    await redis.set(`${key}:lock`, 'current', 'PX', 30000)
    const request = {
      id,
      incarnation,
      lockToken: 'stale',
      revision: 4,
      floorUpper: Date.now() + 10000,
      nominalDeadline: Date.now() + 86400000,
    }
    const before = await redis.hgetall(key)
    expect(await deferProviderCooldown(redis, queue, request)).toEqual({ reason: 'STATE_CHANGED' })
    expect(await redis.hgetall(key)).toEqual(before)
    expect(await redis.get(`${key}:lock`)).toBe('current')
    expect(await deferProviderCooldown(redis, queue, { ...request, lockToken: 'current' })).toBe(
      'deferred'
    )
    expect(await redis.get(`${key}:lock`)).toBeNull()
    expect(await redis.llen(queue.toKey('active'))).toBe(0)
    expect(await redis.zscore(queue.toKey('delayed'), id)).not.toBeNull()
    expect(
      await redis.hmget(key, 'ats', 'atm', 'amAutoStartsUsed', 'amManualGrant', 'amRevision')
    ).toEqual(['1', '0', '1', 'reserved', '5'])
    expect(Number(await redis.zscore(queue.toKey('marker'), '1'))).toBe(request.floorUpper + 2000)
    expect(await deferProviderCooldown(redis, queue, { ...request, lockToken: 'current' })).toEqual(
      { reason: 'STATE_CHANGED' }
    )
  })

  it.each([
    'command',
    'revision',
    'incarnation',
    'lock',
    'horizon',
    'marker',
    'membership',
    'stalled-type',
  ])(
    'refuses unresolved-command deferral with %s corruption before every write',
    async (corruption) => {
      const id = 'manual-defer'
      const key = queue.toKey(id)
      const incarnation = uuidv7()
      const commandId = uuidv7()
      await queue.add(
        'send-email',
        {
          protocolVersion: 1,
          incarnation,
          jobVersion: 1,
          executionPolicyVersion: 1,
          createdAt: Date.now(),
          payload: {},
        },
        { jobId: id, attempts: 1 }
      )
      await redis.lrem(queue.toKey('wait'), 1, id)
      await redis.lpush(queue.toKey('active'), id)
      await redis.hset(
        key,
        'ats',
        '2',
        'atm',
        '1',
        'amAutoStartsUsed',
        '1',
        'amManualGrant',
        'reserved',
        'amManualCommandId',
        commandId,
        'amRevision',
        '4'
      )
      await redis.set(`${key}:lock`, 'current', 'PX', 30000)
      const input = {
        id,
        incarnation,
        commandId,
        lockToken: 'current',
        revision: 4,
        floorUpper: 0,
        nominalDeadline: Date.now() + 86400000,
      }
      if (corruption === 'command') input.commandId = uuidv7()
      if (corruption === 'revision') input.revision = 3
      if (corruption === 'incarnation') input.incarnation = uuidv7()
      if (corruption === 'lock') input.lockToken = 'stale'
      if (corruption === 'horizon') input.nominalDeadline = Date.now() + 1000
      if (corruption === 'marker') await redis.zadd(queue.toKey('marker'), 0, 'unknown')
      if (corruption === 'membership') await redis.lpush(queue.toKey('wait'), id)
      if (corruption === 'stalled-type') await redis.set(queue.toKey('stalled'), 'wrong-type')
      const snapshot = async () => {
        const keys = (await redis.keys(`${prefix}*`)).sort()
        // Redis DUMP hash field order is not a logical state contract. Compare every
        // key's type and canonical contents, preserving list/stream/zset order.
        return Promise.all(
          keys.map(async (entry) => {
            const type = await redis.type(entry)
            let value: unknown
            switch (type) {
              case 'hash':
                value = Object.entries(await redis.hgetall(entry)).sort(([a], [b]) =>
                  a.localeCompare(b)
                )
                break
              case 'list':
                value = await redis.lrange(entry, 0, -1)
                break
              case 'zset':
                value = await redis.call('ZRANGE', entry, 0, -1, 'WITHSCORES')
                break
              case 'set':
                value = (await redis.smembers(entry)).sort()
                break
              case 'stream':
                value = await redis.xrange(entry, '-', '+')
                break
              default:
                value = await redis.get(entry)
            }
            return [entry, type, value]
          })
        )
      }
      const before = await snapshot()
      expect(await deferProviderCooldown(redis, queue, input)).not.toBe('deferred')
      expect(await snapshot()).toEqual(before)
      expect(await redis.hmget(key, 'ats', 'atm', 'amAutoStartsUsed', 'amManualGrant')).toEqual([
        '2',
        '1',
        '1',
        'reserved',
      ])
    }
  )

  it('fences provider identity/body/time and records a current result witness', async () => {
    const key = `${prefix}provider-job`
    const incarnation = uuidv7()
    const attemptId = uuidv7()
    const digest = 'a'.repeat(64)
    const scope = 'b'.repeat(64)
    const now = Date.now()
    const bodyKey = `${key}:am-request:${incarnation}`
    await redis.hset(
      key,
      'data',
      JSON.stringify({
        protocolVersion: 1,
        incarnation,
        jobVersion: 1,
        executionPolicyVersion: 1,
        createdAt: now,
        payload: {},
      }),
      'opts',
      '{}',
      'ats',
      '1',
      'amRequestPrepared',
      '1',
      'amRequestDigest',
      digest,
      'amProviderScope',
      scope,
      'amRequestExpiresAt',
      now + 86400000
    )
    await redis.set(`${key}:lock`, 'owner', 'PX', 30000)
    await redis.set(bodyKey, '{}', 'PX', 86400000)
    const fence = (
      revision: number,
      deadline = now + 86400000,
      refence = false,
      floor = 0,
      lockToken = 'owner'
    ) =>
      redis.eval(
        PROVIDER_FENCE_LUA,
        4,
        key,
        `${key}:lock`,
        bodyKey,
        `${prefix}meta`,
        incarnation,
        1,
        1,
        revision,
        lockToken,
        epoch,
        digest,
        scope,
        Date.now(),
        deadline,
        floor,
        attemptId,
        1,
        1,
        'none',
        'automatic',
        refence ? '1' : '0',
        3,
        ''
      )
    const before = await redis.hgetall(key)
    expect(await fence(0, now + 94000)).toEqual(['rejected', 'HORIZON_EXPIRED'])
    expect(await redis.hgetall(key)).toEqual(before)
    expect(await fence(0, undefined, false, Date.now() + 10000)).toEqual(['rejected', 'COOLDOWN'])
    expect(await redis.hgetall(key)).toEqual(before)
    expect(await fence(0, undefined, false, 0, 'stale')).toEqual(['rejected', 'STATE_CHANGED'])
    expect(await redis.hgetall(key)).toEqual(before)
    const initial = await fence(0)
    expect(initial).toEqual(['fenced', '1', expect.any(String)])
    expect(await fence(1)).toEqual(['rejected', 'OUTCOME_UNRECORDED'])
    expect(await fence(1, undefined, true)).toEqual(['fenced', '2', expect.any(String)])
    expect(await redis.hget(key, 'amAutoStartsUsed')).toBe('1')
    expect(
      await reportManagedInvocation(redis, key, {
        incarnation,
        invocationId: attemptId,
        revision: 2,
        lockToken: 'owner',
        report: 'success',
        code: 'COMPLETED',
      })
    ).toEqual({ recorded: true, revision: 3 })
    expect(await fence(3, undefined, true)).toEqual(['rejected', 'OUTCOME_UNRECORDED'])
  })
})
