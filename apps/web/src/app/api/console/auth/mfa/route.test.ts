// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

import { GET, POST } from './route'

const config = ADMIN_CONSOLE_CONFIG as unknown as { mode: string }
const original = config.mode
beforeEach(() => {
  config.mode = 'host'
  vi.stubEnv('ADMIN_CONSOLE_HOSTNAME', 'console.example.test')
  vi.stubEnv('ADMIN_CONSOLE_ORIGIN', 'https://console.example.test')
})
afterEach(() => {
  config.mode = original
  vi.unstubAllEnvs()
})
const request = (host: string, method = 'GET', origin?: string) =>
  new Request(`https://${host}/api/auth/mfa`, {
    method,
    headers: { host, ...(origin ? { origin } : {}) },
  })
it('closes wrong hosts before reading credentials', async () => {
  for (const handler of [GET, POST]) {
    const response = await handler(request('shop.example.test', handler === POST ? 'POST' : 'GET'))
    expect(response.status).toBe(404)
    expect(response.headers.get('set-cookie')).toBeNull()
  }
})
it('returns only unavailable on the canonical host and refuses mutation without trusted origin', async () => {
  const read = await GET(request('console.example.test'))
  expect(await read.json()).toEqual({ kind: 'unavailable' })
  expect(read.headers.get('cache-control')).toBe('private, no-store')
  for (const origin of [undefined, 'https://shop.example.test', 'null'])
    expect((await POST(request('console.example.test', 'POST', origin))).status).toBe(403)
  const input = request('console.example.test', 'POST', 'https://console.example.test')
  const body = vi.spyOn(input, 'json')
  const response = await POST(input)
  expect(response.status).toBe(503)
  expect(body).not.toHaveBeenCalled()
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
