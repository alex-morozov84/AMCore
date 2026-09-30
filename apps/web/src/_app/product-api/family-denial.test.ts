// @vitest-environment node
import { cookies } from 'next/headers'
import { afterEach, expect, it, vi } from 'vitest'

import { proxyToBackend } from '@/shared/api/bff/authenticated-proxy'
import { ensureFreshSession } from '@/shared/api/bff/ensure-fresh-session'
import { isTrustedOrigin } from '@/shared/api/bff/origin-guard'
import { createUpstreamRefresh } from '@/shared/api/bff/upstream-refresh'

import { productOrganizationFamilies } from './index'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/shared/api/bff/origin-guard', () => ({ isTrustedOrigin: vi.fn() }))
vi.mock('@/shared/api/bff/ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('@/shared/api/bff/upstream-refresh', () => ({ createUpstreamRefresh: vi.fn() }))
afterEach(() => vi.unstubAllGlobals())

it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])(
  'retained families deny %s before any session or upstream work',
  async (method) => {
    vi.mocked(cookies).mockRejectedValue(new Error('session must not be read'))
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    for (const path of [
      ['organizations'],
      ['organizations', 'id', 'members'],
      ['organizations', 'id', 'roles'],
      ['organizations', 'id', 'invites'],
      ['product-access', 'non-dedicated-probe'],
    ]) {
      const request = new Request('http://web.test/api/probe', { method })
      const response = await proxyToBackend(request, path, productOrganizationFamilies)
      expect(response.status).toBe(404)
    }
    for (const sentinel of [
      cookies,
      isTrustedOrigin,
      ensureFreshSession,
      createUpstreamRefresh,
      upstream,
    ])
      expect(sentinel).not.toHaveBeenCalled()
  }
)
