import { AsyncLocalStorage } from 'node:async_hooks'

import 'server-only'

type Deadline = { expiresAt: number; signal?: AbortSignal }
const current = new AsyncLocalStorage<Deadline>()

export function withRedisRequestDeadline<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  work: () => T
): T {
  const parent = current.getStore()
  return current.run(
    {
      expiresAt: Math.min(parent?.expiresAt ?? Infinity, performance.now() + timeoutMs),
      signal:
        parent?.signal && signal
          ? AbortSignal.any([parent.signal, signal])
          : (signal ?? parent?.signal),
    },
    work
  )
}

export function redisDeadline(timeoutMs: number): Deadline {
  const request = current.getStore()
  return {
    expiresAt: Math.min(request?.expiresAt ?? Infinity, performance.now() + timeoutMs),
    signal: request?.signal,
  }
}
