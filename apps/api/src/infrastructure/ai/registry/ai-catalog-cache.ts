import { randomUUID } from 'node:crypto'

import type { AppRedisClient } from '@/infrastructure/redis'

const KEYS = ['ai:{catalog-v2}:generation', 'ai:{catalog-v2}:data']
const PROBE =
  "redis.call('SET',KEYS[1],ARGV[1],'NX'); return {redis.call('GET',KEYS[1]),redis.call('GET',KEYS[2])}"
const INVALIDATE = "redis.call('SET',KEYS[1],ARGV[1]); redis.call('DEL',KEYS[2]); return ARGV[1]"
const FILL =
  "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3]) end; return false"

/** Limits issued commands, not just caller Promises; issued abort cannot recall a Redis write. */
export class AiCatalogCache {
  private outstanding = 0
  private blockedUntil = 0
  private probing = false
  private closed = false
  private readonly signals = new Set<AbortController>()

  constructor(
    private readonly redis: AppRedisClient,
    private readonly ttl: number
  ) {}

  close(): void {
    this.closed = true
    for (const controller of this.signals) controller.abort()
  }

  async probe(signal?: AbortSignal): Promise<{ token: string; raw: string | null } | null> {
    if (this.probing || performance.now() < this.blockedUntil) return null
    this.probing = true
    try {
      const result = await this.command(PROBE, [randomUUID()], signal)
      if (
        !Array.isArray(result) ||
        typeof result[0] !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(result[0])
      )
        return null
      return { token: result[0], raw: typeof result[1] === 'string' ? result[1] : null }
    } finally {
      this.probing = false
    }
  }

  async invalidate(signal?: AbortSignal): Promise<string | null> {
    const token = randomUUID()
    const result = await this.command(INVALIDATE, [token], signal)
    return result === token ? token : null
  }

  async fill(token: string, raw: string, signal?: AbortSignal): Promise<void> {
    if (Buffer.byteLength(raw) > 1024 * 1024 || performance.now() < this.blockedUntil) return
    await this.command(FILL, [token, raw, String(this.ttl)], signal)
  }

  private async command(script: string, args: string[], signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted()
    if (this.closed || this.outstanding >= 4) {
      this.trip()
      return null
    }
    this.outstanding++
    const controller = new AbortController()
    this.signals.add(controller)
    const abort = (): void => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    let issued: Promise<unknown> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      issued = this.redis
        .withCommandOptions({ abortSignal: controller.signal })
        .eval(script, { keys: KEYS, arguments: args })
      void issued.then(
        () => this.release(controller),
        () => this.release(controller)
      )
      const cutoff = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          this.trip()
          controller.abort()
          resolve(null)
        }, 250)
      })
      return await Promise.race([issued, cutoff])
    } catch {
      if (!issued) this.release(controller)
      this.trip()
      return null
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  private release(controller: AbortController): void {
    if (this.signals.delete(controller)) this.outstanding--
  }

  private trip(): void {
    this.blockedUntil = performance.now() + 1000
  }
}
