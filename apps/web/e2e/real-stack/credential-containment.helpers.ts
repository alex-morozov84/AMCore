import { createClient } from '@redis/client'

import { activeTarget } from '../support/managed-target.mjs'
import { rawOwnedRequest } from '../support/raw-target.mjs'

interface TestUser {
  id: string
  email: string
}
interface Entry {
  version: number
  accessTokenExpiresAt: number
  refreshToken: string
  userSnapshot: TestUser
}

export async function directApi(path: string, body?: object, token?: string) {
  const root = `http://127.0.0.1:${activeTarget().ports.api}/api/v1`
  const response = await fetch(`${root}/${path}`, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(`Direct credential fixture request failed (${response.status})`)
  return response.json()
}

function ownedEntry(raw: string | null, user: TestUser): Entry {
  if (!raw) throw new Error('Test session missing')
  const entry = JSON.parse(raw) as Entry
  if (
    !Number.isInteger(entry.version) ||
    entry.version < 1 ||
    !Number.isFinite(entry.accessTokenExpiresAt) ||
    entry.userSnapshot?.id !== user.id ||
    entry.userSnapshot?.email !== user.email
  ) {
    throw new Error('Test session identity/version mismatch')
  }
  return entry
}

const EXPIRE_OWNED = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('PTTL', KEYS[1]) <= 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'XX', 'KEEPTTL')
return 1
`

/** Caller supplies only the cookie captured from its own fresh test context. */
export async function proveOwnedRefresh(
  sessionCookie: string,
  user: TestUser,
  read: () => Promise<void>
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionCookie) || !user.email.endsWith('@e2e.amcore.test')) {
    throw new Error('Not a test-created session')
  }
  const url = `redis://127.0.0.1:${activeTarget().ports.redis}/0`
  const client = createClient({ url, socket: { reconnectStrategy: false, connectTimeout: 5000 } })
  client.on('error', () => {}) // No credentials or raw records in runner diagnostics.
  try {
    await client.connect()
    const key = `web:session:v1:${sessionCookie}`
    const raw = await client.get(key)
    const before = ownedEntry(raw, user)
    const ttl = await client.pTTL(key)
    if (ttl <= 0) throw new Error('Test session has no positive TTL')
    const expired = { ...JSON.parse(raw!), accessTokenExpiresAt: Date.now() - 60_000 }
    const result = await client.eval(EXPIRE_OWNED, {
      keys: [key],
      arguments: [raw!, JSON.stringify(expired)],
    })
    if (result !== 1) throw new Error('Test session changed concurrently')
    const mutated = ownedEntry(await client.get(key), user)
    const remaining = await client.pTTL(key)
    if (
      mutated.version !== before.version ||
      mutated.accessTokenExpiresAt !== expired.accessTokenExpiresAt ||
      remaining <= 0 ||
      remaining > ttl
    )
      throw new Error('Test expiry mutation failed')
    await read()
    const refreshed = ownedEntry(await client.get(key), user)
    if (
      refreshed.version <= before.version ||
      refreshed.accessTokenExpiresAt <= Date.now() ||
      refreshed.refreshToken === before.refreshToken
    )
      throw new Error('Internal refresh not proved')
  } catch {
    throw new Error('Test-owned vault refresh verification failed')
  } finally {
    if (client.isOpen) await client.close()
  }
}

/** Raw path avoids Request/URL normalization before Next sees dot/encoding probes. */
export async function rawWebRequest(baseURL: string, path: string) {
  return rawOwnedRequest(activeTarget(), baseURL, path)
}
