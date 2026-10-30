import { createClient } from '@redis/client'

import type { WebRedisClient } from '../redis-client'
import { redisClientOptions } from '../redis-client-options'

import { type VaultRedisStats, VaultRedisSupervisor } from './vault-redis-supervisor'
import {
  VAULT_REDIS_DEADLINE_MS,
  VAULT_REDIS_TIMING,
  type VaultRedisClient,
  type VaultRedisEvent,
} from './vault-redis-types'

import 'server-only'

/** After the process creates the client, a caller may wait this long for the first connection. */
const FIRST_USE_WAIT_MS = 1000
const FIRST_USE_WINDOW_MS = 2000
const READY_POLL_MS = 25

let supervisor: VaultRedisSupervisor | undefined
let createdAt = 0

function newClient(): WebRedisClient {
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error(
      'REDIS_URL is not set. The web runtime requires Redis for authenticated BFF flows - see ADR-068.'
    )
  }
  const base = redisClientOptions(url)
  return createClient({
    ...base,
    socket: { ...base.socket, connectTimeout: VAULT_REDIS_TIMING.connectTimeoutMs },
  }) as unknown as WebRedisClient
}

function observe(event: VaultRedisEvent): void {
  if (event.kind === 'client-error')
    console.error('[bff] Vault Redis client error', { generation: event.generation })
  else if (event.kind === 'replaced')
    console.warn('[bff] Vault Redis client generation replaced', {
      generation: event.generation,
      reason: event.reason,
    })
  else if (event.kind === 'alert')
    console.error('[bff] Vault Redis alert', { generation: event.generation, alert: event.alert })
}

function ensureSupervisor(): VaultRedisSupervisor {
  if (!supervisor) {
    supervisor = new VaultRedisSupervisor(newClient, observe)
    createdAt = Date.now()
    supervisor.start()
  }
  return supervisor
}

async function waitForFirstConnection(
  current: VaultRedisSupervisor,
  limitMs: number
): Promise<void> {
  const until = Date.now() + Math.min(limitMs, FIRST_USE_WAIT_MS)
  while (!current.ready && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
}

/**
 * Runs one session-vault Redis command on the supervised connection. A typed `VaultRedisError`
 * (or a node-redis error wrapped in one) reports a failure: a deadline, refused capacity, a client
 * that is not ready yet or a command error. Right after the process created the client the first
 * callers may wait briefly for the first connection; afterwards a client that is not ready is
 * refused at once. Nothing is retried.
 */
export async function runVaultRedis<T>(
  operation: (client: VaultRedisClient, signal: AbortSignal) => Promise<T>,
  deadlineMs: number = VAULT_REDIS_DEADLINE_MS
): Promise<T> {
  const current = ensureSupervisor()
  if (!current.ready && Date.now() - createdAt < FIRST_USE_WINDOW_MS)
    await waitForFirstConnection(current, deadlineMs)
  return current.run(operation, deadlineMs)
}

export function vaultRedisStats(): VaultRedisStats | undefined {
  return supervisor?.stats()
}

/** Disposes the supervised client (tests and orderly shutdown). */
export function stopVaultRedis(): { logicallyOpen: number } {
  const result = supervisor?.stop() ?? { logicallyOpen: 0 }
  supervisor = undefined
  return result
}
