import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'

import { AiCatalogCache } from '../../src/infrastructure/ai/registry/ai-catalog-cache'
import type { AppRedisClient } from '../../src/infrastructure/redis'

import { redisTransportStall } from './redis-transport-stall'

export function catalogueRedisPhysicalProof(): void {
  describe('catalogue Redis wire and generation CAS', () => {
    let container: StartedRedisContainer
    const cleanups: Array<() => Promise<unknown>> = []
    beforeAll(async () => {
      container = await new RedisContainer('redis:7-alpine').start()
    }, 120000)
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
    })
    afterAll(async () => {
      await container?.stop()
    })

    async function fixture(): Promise<{
      stall: Awaited<ReturnType<typeof redisTransportStall>>
      client: Pick<ReturnType<typeof createClient>, 'ping'>
      cache: AiCatalogCache
      issued: () => number
      settled: () => number
    }> {
      const stall = await redisTransportStall(container.getHost(), container.getPort())
      cleanups.push(() => stall.close())
      const client = createClient({
        url: `redis://127.0.0.1:${stall.port}`,
        socket: { reconnectStrategy: false },
      })
      client.on('error', () => undefined)
      await client.connect()
      cleanups.push(async () => {
        if (client.isOpen) client.destroy()
      })
      let issued = 0
      let settled = 0
      const counted = {
        withCommandOptions: (options: { abortSignal: AbortSignal }) => ({
          eval: (...args: Parameters<typeof client.eval>) => {
            issued++
            const result = client.withCommandOptions(options).eval(...args)
            void result.then(
              () => settled++,
              () => settled++
            )
            return result
          },
        }),
      } as unknown as AppRedisClient
      return {
        stall,
        client,
        cache: new AiCatalogCache(counted, 300),
        issued: () => issued,
        settled: () => settled,
      }
    }

    it('after-write abort and cooldown leave four issued commands physically outstanding', async () => {
      const f = await fixture()
      f.stall.holdReplies()
      for (let i = 0; i < 4; i++) expect(await f.cache.invalidate()).toBeNull()
      await f.stall.held
      expect(f.issued()).toBe(4)
      expect(f.settled()).toBe(0)
      expect(await f.cache.invalidate()).toBeNull()
      expect(f.issued()).toBe(4)
      f.stall.release()
      // Ordered Redis PING proves every earlier reply was consumed, without a fixed sleep.
      await f.client.ping()
      expect(f.settled()).toBe(4)
    })

    it('an already issued late fill cannot restore data after another process invalidates', async () => {
      const f = await fixture()
      const probe = await f.cache.probe()
      expect(probe?.token).toBeDefined()
      const remote = createClient({
        url: container.getConnectionUrl(),
        socket: { reconnectStrategy: false },
      })
      remote.on('error', () => undefined)
      await remote.connect()
      cleanups.push(async () => {
        if (remote.isOpen) remote.destroy()
      })
      const other = new AiCatalogCache(remote as AppRedisClient, 300)
      f.stall.holdCommands()
      const fill = f.cache.fill(probe!.token, '["stale"]')
      await f.stall.held
      const generation = await other.invalidate()
      expect(generation).not.toBe(probe!.token)
      await fill // caller timeout; command remains physically issued
      f.stall.release()
      await f.client.ping()
      expect(await remote.get('ai:{catalog-v2}:data')).toBeNull()
    })
  })
}
