import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { activeTarget } from '../support/managed-target.mjs'

import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'
import { readEntry, rewriteEntry, type VaultEntry } from './redis-outage-support'

function tokenTimes(entry: VaultEntry): { iat: number; exp: number } {
  return JSON.parse(Buffer.from(entry.accessToken.split('.')[1]!, 'base64url').toString('utf8'))
}

test('protected access uses the deadline from the API-issued access token', async ({ context }) => {
  const target = activeTarget()
  const origin = target.origins.product
  const registration = await browserCredentialRequest(context.request, '/api/auth/register', {
    headers: { origin },
    data: { email: uniqueEmail('token-expiry'), password: TEST_PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const session = (await context.cookies()).find((cookie) => cookie.name === 'amcore_session')
  if (!session) throw new Error('Test session cookie missing')

  const before = await readEntry(session.value)
  if (!before) throw new Error('Test session missing before protected access')
  const { iat, exp } = tokenTimes(before)
  const lifetime = exp - iat
  const compose = readFileSync(join(target.snapshot, 'docker-compose.yml'), 'utf8')
  const configured = /JWT_ACCESS_EXPIRATION:-([0-9]+)([ms])}/.exec(compose)
  if (!configured) throw new Error('Missing Compose access-token lifetime')
  expect(lifetime).toBe(Number(configured[1]) * (configured[2] === 'm' ? 60 : 1))
  expect(before.accessTokenExpiresAt).toBe(exp * 1000)

  if (lifetime > 30) {
    // Simulate a retained vault entry with a stale timestamp and a still-fresh JWT.
    await rewriteEntry(session.value, (entry) => ({ ...entry, accessTokenExpiresAt: 0 }))
  }

  expect((await context.request.get('/api/auth/me')).status()).toBe(200)
  const after = await readEntry(session.value)
  if (!after) throw new Error('Test session missing after protected access')

  if (lifetime === 30) {
    const renewed = tokenTimes(after)
    expect(renewed.exp - renewed.iat).toBe(30)
    expect(after.accessTokenExpiresAt).toBe(renewed.exp * 1000)
    expect(after.version).toBeGreaterThan(before.version)
    expect(after.refreshToken === before.refreshToken).toBe(false)
  } else {
    expect(after.version).toBe(before.version)
    expect(after.refreshToken === before.refreshToken).toBe(true)
  }
})
