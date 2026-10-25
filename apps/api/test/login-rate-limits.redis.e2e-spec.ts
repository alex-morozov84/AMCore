import { jest } from '@jest/globals'
import KeyvRedis from '@keyv/redis'
import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import type { Cache } from 'cache-manager'

import { LoginRateLimiterService } from '../src/core/auth/login-rate-limiter.service'
import { LOGIN_LIMIT_SCRIPT, LOGIN_LIMIT_VALIDATION } from '../src/core/auth/login-rate-limits.lua'
import { EnvService } from '../src/env/env.service'

import { e2eContainerLabels } from './e2e-owned-containers'

const ip = '203.0.113.1'
const email = 'login@e2e.amcore.test'
const keys = (who = email, address = ip): [string, string, string] => [
  `rate:login_ip:${address}`,
  `rate:login_user_ip:${who}:${address}`,
  `rate:login_blocked:${who}:${address}`,
]
const payload = (value: number, expires = Date.now() + 100000): string =>
  JSON.stringify({ value, expires })

describe('Login atomic accounting with installed CacheModule and Redis7', () => {
  let broker: StartedRedisContainer
  let client: ReturnType<typeof createClient>
  let module: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>
  let cache: Cache
  let first: LoginRateLimiterService
  let second: LoginRateLimiterService
  beforeAll(async () => {
    broker = await new RedisContainer('redis:7-alpine').withLabels(e2eContainerLabels()).start()
    client = createClient({ url: broker.getConnectionUrl() })
    await client.connect()
    module = await Test.createTestingModule({
      imports: [CacheModule.register({ stores: [new KeyvRedis(client)], ttl: 60000 })],
    }).compile()
    cache = module.get<Cache>(CACHE_MANAGER)
    const env = new EnvService(new ConfigService({ REDIS_URL: broker.getConnectionUrl() }))
    first = new LoginRateLimiterService(env)
    second = new LoginRateLimiterService(env)
    console.info(
      'Login limiter fixture:',
      (await client.info('server')).match(/redis_version:([^\r\n]+)/)?.[1]
    )
  }, 120000)
  beforeEach(async () => {
    jest.restoreAllMocks()
    await client.flushDb()
  })
  afterAll(async () => {
    await first?.onModuleDestroy()
    await second?.onModuleDestroy()
    await module?.close()
    if (client?.isOpen) await client.quit()
    await broker?.stop()
  }, 60000)
  it('retains old keys and debt, writes safe compatible envelopes back', async () => {
    await cache.set(keys()[0], 99, 240000)
    await first.check(email, ip)
    const before = await client.get(keys()[0])
    const ttl = await client.pTTL(keys()[0])
    await first.reset(email, ip)
    expect(await client.get(keys()[0])).toBe(before)
    expect(await client.pTTL(keys()[0])).toBeLessThanOrEqual(ttl)
    await first.consume(email, ip)
    expect(await cache.get(keys()[0])).toBe(100)
    expect(await cache.get(keys()[1])).toBe(1)
    await expect(first.check(email, ip)).rejects.toMatchObject({
      status: 429,
      details: { retryAfterSeconds: 86400 },
    })
    expect((await client.keys('*')).sort()).toEqual(keys().slice(0, 2).sort())
  })
  it('records exactly32 admitted failures across independent instances', async () => {
    await Promise.all(
      Array.from({ length: 32 }, (_, i) => (i % 2 ? first : second).consume(email, ip))
    )
    expect(await cache.get(keys()[0])).toBe(32)
    expect(await cache.get(keys()[1])).toBe(32)
    expect(await cache.get(keys()[2])).toBe(1)
    await expect(first.check(email, ip)).rejects.toMatchObject({
      status: 429,
      details: { retryAfterSeconds: 900 },
    })
  })
  it('keeps old peer debt while a missing visitor key starts fresh and an existing visitor key is enforced', async () => {
    await cache.set(keys(email, '172.20.0.10')[0], 100, 100000)
    await first.check(email, ip)
    expect(await cache.get(keys(email, '172.20.0.10')[0])).toBe(100)
    expect(await client.get(keys()[0])).toBeNull()
    await cache.set(keys()[0], 100, 100000)
    await expect(first.check(email, ip)).rejects.toMatchObject({ status: 429 })
    expect(await cache.get(keys(email, '172.20.0.10')[0])).toBe(100)
  })
  it('preserves other pairs and both reset/consume serialization orders', async () => {
    await first.consume(email, ip)
    await first.consume('other', ip)
    const aggregate = await client.get(keys()[0])
    await first.reset(email, ip)
    expect(await client.get(keys()[0])).toBe(aggregate)
    expect(await cache.get(keys('other')[1])).toBe(1)
    expect(await client.mGet(keys().slice(1))).toEqual([null, null])
    await second.consume(email, ip)
    expect(await cache.get(keys()[1])).toBe(1)
    await first.reset(email, ip)
    expect(await client.mGet(keys().slice(1))).toEqual([null, null])
    await first.consume(email, '203.0.113.2')
    expect(await cache.get(keys(email, '203.0.113.2')[0])).toBe(1)
  })
  it.each([
    'broken',
    '{"value":1.5,"expires":9999999999999}',
    '{"value":9007199254740992,"expires":9999999999999}',
    'x'.repeat(1025),
  ])('validates the entire trio before any mutation (%s)', async (bad) => {
    await cache.set(keys()[0], 2, 100000)
    await client.set(keys()[1], bad, { PX: 100000 })
    const before = await client.mGet(keys())
    for (const mode of ['check', 'consume', 'reset'] as const)
      await expect(first[mode](email, ip)).rejects.toMatchObject({ status: 503 })
    expect(await client.mGet(keys())).toEqual(before)
  })
  it('rejects permanent and wrong-type state, preserves positive native TTL and expires logically without check writes', async () => {
    await client.set(keys()[0], payload(5))
    expect(await client.pTTL(keys()[0])).toBe(-1)
    await expect(first.check(email, ip)).rejects.toMatchObject({ status: 503 })
    await client.del(keys()[0])
    await client.lPush(keys()[0], 'x')
    await client.pExpire(keys()[0], 10000)
    await expect(first.reset(email, ip)).rejects.toMatchObject({ status: 503 })
    await client.del(keys()[0])
    await client.set(keys()[0], payload(100, Date.now() - 1000), { PX: 10000 })
    const raw = await client.get(keys()[0])
    await first.check(email, ip)
    expect(await client.get(keys()[0])).toBe(raw)
    await first.consume(email, ip)
    expect(await cache.get(keys()[0])).toBe(1)
    expect(await client.pTTL(keys()[0])).toBeGreaterThan(86399000)
    await client.pExpireAt(keys()[0], Date.now() - 1)
    expect(await client.pTTL(keys()[0])).toBe(-2)
  })
  it('roundtrips exact safe integers, rejects overflow before any write', async () => {
    await cache.set(keys()[0], Number.MAX_SAFE_INTEGER - 1, 100000)
    await first.consume(email, ip)
    expect(await cache.get(keys()[0])).toBe(Number.MAX_SAFE_INTEGER)
    const raw = await client.mGet(keys())
    await expect(first.consume(email, ip)).rejects.toMatchObject({ status: 503 })
    expect(await client.mGet(keys())).toEqual(raw)
  })
  it('returns503 without replay when Redis ACL refuses the script keys', async () => {
    await client.sendCommand([
      'ACL',
      'SETUSER',
      'login-fixture',
      'on',
      '>fixture-only-password',
      '+eval',
      '+get',
      '+type',
      '+pttl',
      '+set',
      '+del',
      '+select',
      '+auth',
      '%R~*',
      '%W~rate:login_ip:*',
    ])
    const url = new URL(broker.getConnectionUrl())
    url.username = 'login-fixture'
    url.password = 'fixture-only-password'
    const limited = new LoginRateLimiterService(
      new EnvService(new ConfigService({ REDIS_URL: url.toString() }))
    )
    try {
      await expect(limited.consume(email, ip)).rejects.toMatchObject({ status: 503 })
      // Redis checks script key permissions before execution in this fixture.
      expect(await cache.get(keys()[0])).toBeUndefined()
      expect(await client.get(keys()[1])).toBeNull()
    } finally {
      await limited.onModuleDestroy()
      await client.sendCommand(['ACL', 'DELUSER', 'login-fixture'])
    }
  })
  it('records isolated limiter connection cost on sequential and moderate parallel paths', async () => {
    const before = Number(
      (await client.info('stats')).match(/total_connections_received:(\d+)/)?.[1]
    )
    const samples: number[] = []
    const attempt = async (index: number) => {
      const start = performance.now()
      await first.check(`cost${index}`, ip)
      if (index % 2) await first.consume(`cost${index}`, ip)
      else await first.reset(`cost${index}`, ip)
      samples.push(performance.now() - start)
    }
    for (let i = 0; i < 8; i++) await attempt(i)
    await Promise.all(Array.from({ length: 8 }, (_, i) => attempt(i + 8)))
    const after = Number(
      (await client.info('stats')).match(/total_connections_received:(\d+)/)?.[1]
    )
    samples.sort((a, b) => a - b)
    console.info('Limiter cost, Redis7 same fixture, check+consume/reset, sequential8/parallel8:', {
      p50Ms: samples[8],
      p95Ms: samples[15],
      connectionOpenings: after - before,
    })
    expect(after - before).toBe(32)
  })
  it('applies full production check/consume/reset at controlled native0 without renewing aggregate on reset', async () => {
    const harness =
      `local original=redis.call
local input=ARGV
local ttl=tonumber(input[3])
local ARGV={input[1],input[2]}
local redis={call=function(cmd, ...) if cmd=='PTTL' then if original('EXISTS', ...) == 0 then return -2 end return ttl end return original(cmd, ...) end}
` + LOGIN_LIMIT_SCRIPT
    const run = (mode: string, time: number) =>
      client.eval(harness, { keys: keys(), arguments: [mode, String(time), '0'] })
    await client.set(keys()[0], payload(100, 1000), { PX: 100000 })
    await client.set(keys()[1], payload(4, 1000), { PX: 100000 })
    await client.set(keys()[2], payload(1, 1000), { PX: 100000 })
    const before = await client.mGet(keys())
    expect(await run('check', 1000)).toEqual([0, 900])
    expect(await client.mGet(keys())).toEqual(before)
    expect(await run('reset', 1000)).toEqual([1, 0])
    expect(await client.get(keys()[0])).toBe(before[0])
    // Missing keys must retain real -2;0 is supplied only for existing keys.
    const actualPttlHarness = harness
    expect(
      await client.eval(actualPttlHarness, { keys: keys(), arguments: ['check', '1000', '0'] })
    ).toEqual([0, 86400])
    await client.set(keys()[1], payload(4, 1000), { PX: 100000 })
    expect(
      await client.eval(actualPttlHarness, { keys: keys(), arguments: ['consume', '1000', '0'] })
    ).toEqual([1, 0])
    expect(JSON.parse((await client.get(keys()[0]))!).value).toBe(101)
    expect(JSON.parse((await client.get(keys()[1]))!).value).toBe(5)
    expect(await client.pTTL(keys()[2])).toBeGreaterThan(89900)
    const raw = await client.mGet(keys())
    expect(await run('consume', Number.MAX_SAFE_INTEGER)).toEqual([-1, 0])
    expect(await client.mGet(keys())).toEqual(raw)
  })
  it('rejects malformed envelopes at controlled native0 before mutation', async () => {
    const harness =
      `local original=redis.call
local redis={call=function(cmd, ...) if cmd=='PTTL' then if original('EXISTS', ...) == 0 then return -2 end return 0 end return original(cmd, ...) end}
` + LOGIN_LIMIT_SCRIPT
    await client.set(keys()[0], payload(1), { PX: 100000 })
    await client.set(keys()[1], 'malformed', { PX: 100000 })
    const before = await client.mGet(keys())
    expect(
      await client.eval(harness, { keys: keys(), arguments: ['consume', String(Date.now())] })
    ).toEqual([-1, 0])
    expect(await client.mGet(keys())).toEqual(before)
  })
  it('proves exact PTTL=0/equality branches with the same Lua validation, separately from native Redis expiry', async () => {
    // Controlled branch harness; Redis TYPE/GET are real, PTTL/time alone are supplied.
    const harness =
      `local original = redis.call
local redis = {call = function(cmd, ...) if cmd == 'PTTL' then return tonumber(ARGV[3]) end return original(cmd, ...) end}
` +
      LOGIN_LIMIT_VALIDATION +
      `return {read(KEYS[1],86400000,false,tonumber(ARGV[1])) or -1}`
    await client.set(keys()[0], payload(100, 1000), { PX: 100000 })
    for (const [ttl, time, expected] of [
      [0, 999, 100],
      [0, 1000, 100],
      [0, 1001, 0],
      [-2, 1000, 0],
      [-1, 1000, -1],
      [1, 1000, 100],
    ]) {
      expect(
        await client.eval(harness, {
          keys: [keys()[0]],
          arguments: [String(time), 'unused', String(ttl)],
        })
      ).toEqual([expected])
    }
  })
})
