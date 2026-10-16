import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyIndexingPolicy, isIndexingEffective, NOINDEX_HEADER_VALUE } from './indexing'

const open = {
  WEB_SEO_INDEXING: 'enabled',
  WEB_SITE_ORIGIN: 'https://shop.example.com',
}

describe('isIndexingEffective', () => {
  it('is true only when enabled, the origin is usable and the Host matches', () => {
    expect(isIndexingEffective('shop.example.com', open)).toBe(true)
  })

  it.each([
    ['indexing unset', { WEB_SITE_ORIGIN: open.WEB_SITE_ORIGIN }],
    ['indexing disabled', { ...open, WEB_SEO_INDEXING: 'disabled' }],
    ['a typo in the switch', { ...open, WEB_SEO_INDEXING: 'true' }],
    ['origin unset', { WEB_SEO_INDEXING: 'enabled' }],
    ['origin unusable', { ...open, WEB_SITE_ORIGIN: 'shop.example.com' }],
  ])('is false with %s', (_name, env) => {
    expect(isIndexingEffective('shop.example.com', env)).toBe(false)
  })

  it.each([
    'staging.example.com',
    'www.shop.example.com',
    'shop.example.com:8443',
    '203.0.113.7',
    'admin.shop.example.com',
    '',
    null,
    undefined,
  ])('is false for the other or missing host %p', (host) => {
    expect(isIndexingEffective(host, open)).toBe(false)
  })
})

describe('applyIndexingPolicy', () => {
  afterEach(() => vi.unstubAllEnvs())

  const request = (host: string | null, extra?: Record<string, string>) => ({
    headers: {
      get: (name: string) => (name === 'host' ? host : (extra?.[name.toLowerCase()] ?? null)),
    },
  })
  const response = () => {
    const set = vi.fn()
    return { headers: { set }, set }
  }

  it('closes the response when indexing is not effective', () => {
    vi.stubEnv('WEB_SEO_INDEXING', '')
    const res = response()
    applyIndexingPolicy(request('shop.example.com'), res)
    expect(res.set).toHaveBeenCalledExactlyOnceWith('X-Robots-Tag', NOINDEX_HEADER_VALUE)
  })

  it('does nothing on the site host when indexing is effective', () => {
    vi.stubEnv('WEB_SEO_INDEXING', 'enabled')
    vi.stubEnv('WEB_SITE_ORIGIN', 'https://shop.example.com')
    const res = response()
    applyIndexingPolicy(request('shop.example.com'), res)
    expect(res.set).not.toHaveBeenCalled()
  })

  it('still closes every other host while indexing is enabled', () => {
    vi.stubEnv('WEB_SEO_INDEXING', 'enabled')
    vi.stubEnv('WEB_SITE_ORIGIN', 'https://shop.example.com')
    const res = response()
    applyIndexingPolicy(request('staging.example.com'), res)
    expect(res.set).toHaveBeenCalledExactlyOnceWith('X-Robots-Tag', NOINDEX_HEADER_VALUE)
  })

  it('ignores a spoofed X-Forwarded-Host', () => {
    vi.stubEnv('WEB_SEO_INDEXING', 'enabled')
    vi.stubEnv('WEB_SITE_ORIGIN', 'https://shop.example.com')
    const res = response()
    applyIndexingPolicy(
      request('staging.example.com', { 'x-forwarded-host': 'shop.example.com' }),
      res
    )
    expect(res.set).toHaveBeenCalledExactlyOnceWith('X-Robots-Tag', NOINDEX_HEADER_VALUE)
  })

  it('only ever sets the header: it exposes no way to remove or weaken it', () => {
    const res = response()
    applyIndexingPolicy(request('shop.example.com'), res)
    expect(Object.keys(res.headers)).toEqual(['set'])
  })
})
