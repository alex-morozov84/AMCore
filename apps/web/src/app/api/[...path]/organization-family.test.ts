// @vitest-environment node
import { cookies } from 'next/headers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as route from '@/app/api/[...path]/route'
import { ensureFreshSession } from '@/shared/api/bff/ensure-fresh-session'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/shared/api/bff/ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('@/shared/api/bff/session-vault-store', () => ({ redisVaultStore: {} }))
vi.mock('@/shared/api/bff/session-lock', () => ({ redisVaultLock: {} }))

afterEach(() => vi.unstubAllGlobals())

describe('composed generic organization aliases close before authentication', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    '%s cannot bypass the typed boundary',
    async (method) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      vi.mocked(cookies).mockClear()
      vi.mocked(ensureFreshSession).mockClear()
      for (const path of [
        ['organizations'],
        ['organizations', 'org-a', 'roles'],
        ['organizations', 'org-a', 'role-definitions'],
        ['organizations', 'org-a', 'role-definitions', 'role-1', 'deletion'],
        ['organizations', 'org-a', 'capabilities'],
        ['product-access', 'bootstrap'],
        ['other', '..', 'organizations', 'org-a'],
      ]) {
        const response = await route[method](
          new Request('http://web.test/api/alias', {
            method,
            headers: { origin: 'http://foreign.test' },
          }),
          { params: Promise.resolve({ path }) }
        )
        expect(response.status).toBe(404)
      }
      expect(cookies).not.toHaveBeenCalled()
      expect(ensureFreshSession).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    }
  )
})
