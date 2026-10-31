import { execFile } from 'node:child_process'
import { resolve } from 'node:path'

import { type BrowserContext, expect } from '@playwright/test'
import { createClient } from '@redis/client'

import { activeTarget, guardedExec, guardedSql } from '../support/managed-target.mjs'

import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'

// Shared by the real-stack Redis-outage specs: the stand's own Redis is read and rewritten only for
// sessions the test created, and stalled with `CLIENT PAUSE ... ALL`.

export interface VaultEntry {
  version: number
  accessTokenExpiresAt: number
  refreshToken: string
  userSnapshot: { id: string }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const vaultClient = () =>
  createClient({
    url: `redis://127.0.0.1:${activeTarget().ports.redis}/0`,
    RESP: 2,
    socket: { reconnectStrategy: false, connectTimeout: 5000 },
  })

async function withVault<T>(
  work: (client: ReturnType<typeof vaultClient>) => Promise<T>
): Promise<T> {
  const client = vaultClient()
  client.on('error', () => undefined)
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.close()
  }
}

const keyOf = (cookie: string) => `web:session:v1:${cookie}`

export async function readEntry(cookie: string): Promise<VaultEntry | null> {
  const raw = await withVault((client) => client.get(keyOf(cookie)))
  return raw ? (JSON.parse(raw) as VaultEntry) : null
}

/** Rewrites only this test-created entry, keeping its TTL; used to age the access token or replay a stale refresh token. */
export async function rewriteEntry(
  cookie: string,
  change: (entry: VaultEntry) => VaultEntry
): Promise<void> {
  await withVault(async (client) => {
    const raw = await client.get(keyOf(cookie))
    if (!raw) throw new Error('Test session missing')
    const next = change(JSON.parse(raw) as VaultEntry)
    const result = await client.set(keyOf(cookie), JSON.stringify(next), {
      condition: 'XX',
      expiration: 'KEEPTTL',
    })
    if (result !== 'OK') throw new Error('Test session rewrite failed')
  })
}

export const ageAccessToken = (entry: VaultEntry): VaultEntry => ({
  ...entry,
  accessTokenExpiresAt: Date.now() - 60_000,
})

export function pauseRedis(ms: number): void {
  guardedExec('redis', 'redis-cli', 'CLIENT', 'PAUSE', String(ms), 'ALL')
}

export async function signedIn(context: BrowserContext, origin: string): Promise<string> {
  const email = uniqueEmail('redis-outage')
  const registration = await browserCredentialRequest(context.request, '/api/auth/register', {
    headers: { origin },
    data: { email, password: TEST_PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const cookie = (await context.cookies()).find((c) => c.name === 'amcore_session')
  if (!cookie) throw new Error('Test-created cookie missing')
  expect((await context.request.get('/api/auth/me')).status()).toBe(200)
  return cookie.value
}

export async function untilServed(context: BrowserContext, limitMs: number): Promise<number> {
  const started = performance.now()
  for (;;) {
    const res = await context.request.get('/api/auth/me', { timeout: 8000 }).catch(() => null)
    if (res?.status() === 200) return Math.round(performance.now() - started)
    if (performance.now() - started > limitMs) throw new Error(`not served within ${limitMs} ms`)
    await sleep(250)
  }
}

/** Number of session rows (login plus one per accepted rotation) the backend holds for a user. */
export function sessionRows(userId: string): number {
  return Number(
    guardedSql('SELECT count(*) FROM core.sessions WHERE "userId" = :\'uid\';', { uid: userId })
  )
}

/**
 * Holds an exclusive lock on the invitation handoff table for `ms`. The backend refresh takes a row
 * lock there first, the binding check does not read it, so a refresh the API has already received
 * stays in progress while admission still works. Same guarded Postgres fixture path as `guardedSql`,
 * asynchronous.
 */
/** True once the lock taken by `holdRefreshInProgress` is granted. */
export function refreshHoldActive(): boolean {
  const granted = guardedSql(
    "SELECT count(*) FROM pg_locks WHERE relation = 'core.invitation_auth_handoffs'::regclass AND mode = 'AccessExclusiveLock' AND granted;"
  )
  return granted.trim() === '1'
}

export function holdRefreshInProgress(ms: number): Promise<void> {
  const script = resolve(process.cwd(), '../../scripts/stand/exec.mjs')
  const query = `LOCK TABLE core.invitation_auth_handoffs IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(${ms / 1000});`
  return new Promise((done, fail) =>
    execFile(
      process.execPath,
      [script, 'postgres', 'psql', '-c', query, '--stand-variables', '{}'],
      {
        env: {
          NODE_ENV: 'test' as const,
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
          AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
        },
      },
      (error) => (error ? fail(error) : done())
    )
  )
}
