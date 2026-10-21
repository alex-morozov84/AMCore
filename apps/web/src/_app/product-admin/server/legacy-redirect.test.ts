// @vitest-environment node
import type * as Shared from '@amcore/shared'
import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ mode: 'path' as 'path' | 'host' }))
vi.mock('server-only', () => ({}))
vi.mock('@/shared/api/bff/product-web-context.server', () => ({
  resolveProductWebContext: vi.fn(),
}))
vi.mock('@/shared/lib/product-admin-config.server', () => ({
  productAdminOrigins: () => ({
    admin: settings.mode === 'host' ? 'https://staff.example' : 'https://shop.example',
  }),
}))
vi.mock('@amcore/shared', async (original) => {
  const actual = await original<typeof Shared>()
  return {
    ...actual,
    productAdminPath: (suffix: string) =>
      actual.productAdminPath(suffix, { version: 1, mode: settings.mode, alias: 'manage' }),
  }
})

import { legacyAdminRedirect } from './legacy-redirect'

beforeEach(() => {
  settings.mode = 'path'
})
const redirect = (query: string, method = 'GET') =>
  legacyAdminRedirect(
    new Request(
      `https://shop.example/${DEFAULT_LOCALE}/organizations/org_review/invites?${query}`,
      { method }
    ),
    'invites',
    { locale: DEFAULT_LOCALE, id: 'org_review' }
  )

describe.each(['path', 'host'] as const)('%s invitation compatibility', (mode) => {
  it.each(['GET', 'HEAD'])('preserves domain filters for %s', (method) => {
    settings.mode = mode
    for (const status of ['pending', 'expired', 'all']) {
      const response = redirect(`status=${status}&page=2&search=hello`, method)
      expect(response.status).toBe(308)
      const target = new URL(response.headers.get('location')!)
      expect(target.origin).toBe(mode === 'host' ? 'https://staff.example' : 'https://shop.example')
      expect(target.pathname).toBe(
        new URL(
          localizedFrontendUrl(
            'https://shop.example',
            DEFAULT_LOCALE,
            `${mode === 'path' ? '/manage' : ''}/organizations/org_review/invites`
          )
        ).pathname
      )
      expect(Object.fromEntries(target.searchParams)).toEqual({
        page: '2',
        search: 'hello',
        status,
      })
    }
  })
  it.each([
    'status=invalid',
    'status=all&status=expired',
    'page=2&page=3',
    'page=10001',
    'search=a&search=b',
    `search=${'x'.repeat(255)}`,
  ])('drops invalid or repeated domain fields: %s', (query) => {
    settings.mode = mode
    const target = new URL(
      redirect(`${query}&unrelated=secret&view=list&limit=99&role=admin`).headers.get('location')!
    )
    expect(target.search).toBe('')
  })
  it('keeps other valid filters when status is invalid', () => {
    settings.mode = mode
    const target = new URL(
      redirect('status=bad&page=3&search=%20hello%20').headers.get('location')!
    )
    expect(Object.fromEntries(target.searchParams)).toEqual({ page: '3', search: 'hello' })
  })
})
