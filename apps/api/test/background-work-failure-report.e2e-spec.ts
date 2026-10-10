import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import Redis from 'ioredis'
import { v7 as uuidv7 } from 'uuid'

import { reportManagedInvocation } from '../src/infrastructure/background-work/scripts/invocation-report'

/** Optional diagnosis shares the existing hash/CAS/history; no separate evidence owner. */
describe('Bounded failure report before-write predicates', () => {
  let broker: StartedRedisContainer
  let redis: Redis
  const key = 'amcore:failure:job'
  const incarnation = uuidv7(),
    invocationId = uuidv7()
  const report = {
    incarnation,
    invocationId,
    revision: 1,
    lockToken: 'worker',
    report: 'failure' as const,
    code: 'PERMANENT_FAILURE' as const,
    failureCode: 'corrupted_file',
  }
  beforeAll(async () => {
    broker = await new RedisContainer('redis:7-alpine').start()
    redis = new Redis(broker.getConnectionUrl())
  }, 60000)
  beforeEach(async () => {
    await redis.flushdb()
    await redis.hset(key, {
      amIncarnation: incarnation,
      amInvocationId: invocationId,
      amRevision: '1',
      amMetadata: JSON.stringify({
        version: 1,
        report: 'unrecorded',
        invocationId,
        startedAt: Date.now(),
      }),
    })
    await redis.set(`${key}:lock`, 'worker')
  })
  afterAll(async () => {
    await redis?.quit()
    await broker?.stop()
  })
  it('records only a bounded safe identifier under current lock and invocation CAS', async () => {
    expect(await reportManagedInvocation(redis, key, report)).toEqual({
      recorded: true,
      revision: 2,
    })
    const current = JSON.parse((await redis.hget(key, 'amMetadata'))!)
    expect(current).toMatchObject({
      report: 'failure',
      code: 'PERMANENT_FAILURE',
      failureCode: 'corrupted_file',
      invocationId,
    })
    expect(Buffer.byteLength(JSON.stringify(current))).toBeLessThanOrEqual(512)
    expect(JSON.parse((await redis.hget(key, 'amHistory'))!)).toEqual([current])
  })
  it('rejects stale workers and recycled identity without any writes', async () => {
    const before = await redis.hgetall(key)
    for (const input of [
      { ...report, lockToken: 'stale' },
      { ...report, incarnation: uuidv7() },
      { ...report, invocationId: uuidv7() },
      { ...report, revision: 0 },
    ]) {
      expect(await reportManagedInvocation(redis, key, input)).toEqual({
        recorded: false,
        reason: 'STATE_CHANGED',
      })
      expect(await redis.hgetall(key)).toEqual(before)
    }
  })
  it('size-checks the raw history atomically at 8192 bytes before parsing/writing', async () => {
    await redis.hset(key, 'amHistory', '[]' + ' '.repeat(8191))
    const before = await redis.hgetall(key)
    expect(await reportManagedInvocation(redis, key, report)).toEqual({
      recorded: false,
      reason: 'CONTENT_UNSUPPORTED',
    })
    expect(await redis.hgetall(key)).toEqual(before)
    await redis.hset(key, 'amHistory', '[]' + ' '.repeat(8190))
    expect(await reportManagedInvocation(redis, key, report)).toEqual({
      recorded: true,
      revision: 2,
    })
    expect(Buffer.byteLength((await redis.hget(key, 'amHistory'))!)).toBeLessThanOrEqual(8192)
  })
  it('rejects summary/history/count overflow before the first write', async () => {
    for (const [metadata, history] of [
      [{ report: 'unrecorded', invocationId, startedAt: 'x'.repeat(600) }, []],
      [
        { report: 'unrecorded', invocationId, startedAt: 1 },
        Array.from({ length: 16 }, () => ({ report: 'failure' })),
      ],
      [{ report: 'unrecorded', invocationId, startedAt: 1 }, [{ pad: '😀'.repeat(200) }]],
    ] as const) {
      await redis.hset(key, {
        amMetadata: JSON.stringify(metadata),
        amHistory: JSON.stringify(history),
      })
      const before = await redis.hgetall(key)
      expect(await reportManagedInvocation(redis, key, report)).toEqual({
        recorded: false,
        reason: 'CONTENT_UNSUPPORTED',
      })
      expect(await redis.hgetall(key)).toEqual(before)
    }
  })
  it('refuses diagnostic attachment to success and invalid identifiers without mutation', async () => {
    const before = await redis.hgetall(key)
    expect(
      await reportManagedInvocation(redis, key, { ...report, report: 'success', code: 'COMPLETED' })
    ).toEqual({ recorded: false, reason: 'CONTENT_UNSUPPORTED' })
    await expect(
      reportManagedInvocation(redis, key, { ...report, failureCode: 'secret://private' })
    ).rejects.toThrow()
    expect(await redis.hgetall(key)).toEqual(before)
  })
})
