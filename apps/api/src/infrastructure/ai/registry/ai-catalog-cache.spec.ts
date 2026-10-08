import { AiCatalogCache } from './ai-catalog-cache'

import type { AppRedisClient } from '@/infrastructure/redis'

function fixture() {
  const commands: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  const evalCommand = jest.fn(
    () =>
      new Promise((resolve, reject) => {
        commands.push({ resolve, reject })
      })
  )
  const redis = {
    withCommandOptions: jest.fn(() => ({ eval: evalCommand })),
  } as unknown as AppRedisClient
  return { commands, evalCommand, cache: new AiCatalogCache(redis, 300) }
}

describe('catalogue Redis physical permits', () => {
  afterEach(() => jest.useRealTimers())

  it('logical timeout/abort/cooldown never releases an issued command permit', async () => {
    jest.useFakeTimers()
    const f = fixture()
    for (let i = 0; i < 4; i++) {
      const pending = f.cache.invalidate()
      await jest.advanceTimersByTimeAsync(251)
      expect(await pending).toBeNull()
    }
    await jest.advanceTimersByTimeAsync(5000)
    expect(await f.cache.invalidate()).toBeNull()
    expect(f.evalCommand).toHaveBeenCalledTimes(4)
    f.commands[0]!.reject(new Error('late'))
    await Promise.resolve()
    const fifth = f.cache.invalidate()
    expect(f.evalCommand).toHaveBeenCalledTimes(5)
    f.commands[4]!.resolve(null)
    await fifth
    f.cache.close()
    for (const command of f.commands) command.resolve(null)
  })

  it('teardown/aborted caller issues nothing; huge fill does not consume a permit', async () => {
    const f = fixture()
    await expect(f.cache.probe(AbortSignal.abort())).rejects.toBeDefined()
    await f.cache.fill('token', 'x'.repeat(1024 * 1024 + 1))
    f.cache.close()
    await f.cache.invalidate()
    expect(f.evalCommand).not.toHaveBeenCalled()
  })
})
