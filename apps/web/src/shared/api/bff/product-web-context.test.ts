// @vitest-environment node
import type * as Shared from '@amcore/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ mode: 'path' as 'path' | 'host' }))
vi.mock('server-only', () => ({}))
vi.mock('@amcore/shared', async (original) => {
  const actual = await original<typeof Shared>()
  return {
    ...actual,
    get PRODUCT_ADMIN_CONFIG() {
      return { ...actual.PRODUCT_ADMIN_CONFIG, mode: settings.mode }
    },
  }
})

import { productAdminDeployment } from '@/shared/lib/product-admin-config.server'

import { ContextRequestError } from './context-errors'
import {
  frontendApiHeaders,
  isProductMutationTrusted,
  resolveProductWebContext,
} from './product-web-context.server'

const source = (host: string) => new Headers({ host, 'x-amcore-web-frontend': 'untrusted' })

beforeEach(() => {
  settings.mode = 'path'
  vi.stubEnv('FRONTEND_URL', 'https://shop.example')
  vi.stubEnv('PRODUCT_ADMIN_ORIGIN', '')
  vi.stubEnv('WEB_FRONTEND_CONTEXT_KEY', '<fake-test-frontend-context-key-at-least-32>')
})
afterEach(() => vi.unstubAllEnvs())

describe('server-selected product context', () => {
  it('shares path-mode identity while keeping explicit admin destinations', () => {
    vi.stubEnv('PRODUCT_ADMIN_ORIGIN', 'https://shop.example')
    const site = resolveProductWebContext(source('shop.example'), 'site-auth')
    const admin = resolveProductWebContext(source('shop.example'), 'admin-auth')
    expect(admin.audience).toBe('product')
    expect(admin.cookieName).toBe(site.cookieName)
    expect(admin.store).toBe(site.store)
    expect(admin.lock).toBe(site.lock)
    expect(admin.loginPath).toBe('/manage/login')
    expect(admin.frontend).toBe('admin')
    expect(site.frontend).toBe('site')
  })

  it('selects independent staff identity from actual host only', () => {
    settings.mode = 'host'
    vi.stubEnv('PRODUCT_ADMIN_ORIGIN', 'https://office.example:9443')
    const site = resolveProductWebContext(source('shop.example'), 'product-data')
    const staff = resolveProductWebContext(source('office.example:9443'), 'product-data')
    expect(staff.audience).toBe('staff')
    expect(staff.cookieName).toBe('__Host-amcore_staff_session')
    expect(staff.cookieOptions).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    })
    expect(staff.cookieOptions).not.toHaveProperty('domain')
    expect(staff.store).not.toBe(site.store)
    expect(staff.lock).not.toBe(site.lock)
    expect(staff.namespace).toBe('web:staff-session:v1')
    expect(staff.loginPath).toBe('/login')
    expect(frontendApiHeaders(staff, source('attacker.example')).get('x-amcore-web-frontend')).toBe(
      'admin'
    )
  })

  it.each([
    'attacker.example',
    'shop.example:9443',
    'shop.example@attacker.example',
    'shop.example,office.example',
  ])('rejects unconfigured or ambiguous authority: %s', (host) => {
    vi.stubEnv('PRODUCT_ADMIN_ORIGIN', 'https://shop.example')
    expect(() => resolveProductWebContext(source(host), 'product-data')).toThrow(
      ContextRequestError
    )
  })

  it('does not allow site credentials or legacy invitation entry on staff host', () => {
    settings.mode = 'host'
    vi.stubEnv('PRODUCT_ADMIN_ORIGIN', 'https://office.example')
    for (const kind of ['site-auth', 'legacy-invite'] as const)
      expect(() => resolveProductWebContext(source('office.example'), kind)).toThrow(
        ContextRequestError
      )
    expect(() => resolveProductWebContext(source('shop.example'), 'admin-auth')).toThrow(
      ContextRequestError
    )
  })

  it('keeps scheme and port in exact Origin/Referer checks', () => {
    settings.mode = 'host'
    vi.stubEnv('PRODUCT_ADMIN_ORIGIN', 'https://office.example:9443')
    const context = resolveProductWebContext(source('office.example:9443'), 'admin-auth')
    const request = (headers: Record<string, string>) =>
      new Request('https://office.example:9443/api/test', { method: 'POST', headers })
    expect(isProductMutationTrusted(request({ origin: context.origin }), context)).toBe(true)
    expect(
      isProductMutationTrusted(request({ referer: `${context.origin}/ru/login` }), context)
    ).toBe(true)
    for (const origin of [
      'https://shop.example',
      'https://office.example',
      'http://office.example:9443',
      'null',
    ])
      expect(isProductMutationTrusted(request({ origin }), context)).toBe(false)
    expect(isProductMutationTrusted(request({}), context)).toBe(false)
  })

  it('refuses same hostname on another port before selecting a cookie', () => {
    settings.mode = 'host'
    vi.stubEnv('PRODUCT_ADMIN_ORIGIN', 'https://shop.example:9443')
    expect(() => productAdminDeployment()).toThrow('different hostname')
  })
})
