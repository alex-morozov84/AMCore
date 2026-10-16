import { describe, expect, it } from 'vitest'

import { assertSeoConfig, getSiteOrigin, isIndexingEnabled, parseSiteOrigin } from './site-origin'

describe('parseSiteOrigin', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['  https://example.com  ', 'https://example.com'],
    ['https://shop.example.com:8443', 'https://shop.example.com:8443'],
    ['http://localhost:3002', 'http://localhost:3002'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
  ])('accepts the canonical origin %p', (raw, origin) => {
    expect(parseSiteOrigin(raw)).toBe(origin)
  })

  it.each([
    undefined,
    '',
    '   ',
    'example.com',
    'https://example.com/',
    'https://example.com/shop',
    'https://example.com?x=1',
    'https://example.com#top',
    'https://user:pw@example.com',
    'http://example.com',
    'ftp://example.com',
    'javascript:alert(1)',
    'https://*.example.com',
  ])('refuses %p, so no wrong absolute URL is ever emitted', (raw) => {
    expect(parseSiteOrigin(raw)).toBeNull()
  })
})

describe('isIndexingEnabled', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['disabled', false],
    ['true', false],
    ['ENABLED', false],
    ['enabled', true],
    [' enabled ', true],
  ])('WEB_SEO_INDEXING=%p is %p', (value, expected) => {
    expect(isIndexingEnabled({ WEB_SEO_INDEXING: value })).toBe(expected)
  })
})

describe('getSiteOrigin', () => {
  it('reads WEB_SITE_ORIGIN from the given environment', () => {
    expect(getSiteOrigin({ WEB_SITE_ORIGIN: 'https://example.com' })).toBe('https://example.com')
    expect(getSiteOrigin({})).toBeNull()
  })
})

describe('assertSeoConfig', () => {
  const enabled = {
    WEB_SEO_INDEXING: 'enabled',
    WEB_SITE_ORIGIN: 'https://example.com',
    WEB_TRUSTED_ORIGINS: 'https://example.com',
  }

  it('accepts a complete enabled configuration, with trusted origins in any form', () => {
    expect(() => assertSeoConfig(enabled)).not.toThrow()
    expect(() =>
      assertSeoConfig({
        ...enabled,
        WEB_TRUSTED_ORIGINS: 'http://localhost:3002, https://example.com/ ',
      })
    ).not.toThrow()
  })

  it.each([undefined, '', 'disabled'])('never stops start-up when indexing is %p', (mode) => {
    expect(() => assertSeoConfig({ WEB_SEO_INDEXING: mode })).not.toThrow()
    expect(() =>
      assertSeoConfig({ WEB_SEO_INDEXING: mode, WEB_SITE_ORIGIN: 'not a url' })
    ).not.toThrow()
  })

  it.each(['true', 'on', 'yes', 'Enabled'])(
    'stops start-up on the typo WEB_SEO_INDEXING=%s',
    (v) => {
      expect(() => assertSeoConfig({ WEB_SEO_INDEXING: v })).toThrow(/enabled/)
    }
  )

  it.each([
    ['missing', undefined],
    ['invalid', 'not a url'],
    ['http', 'http://example.com'],
    ['loopback http', 'http://localhost:3002'],
    ['with a path', 'https://example.com/shop'],
  ])('stops start-up when enabled and the origin is %s', (_name, origin) => {
    expect(() =>
      assertSeoConfig({ ...enabled, WEB_SITE_ORIGIN: origin, WEB_TRUSTED_ORIGINS: origin })
    ).toThrow(/WEB_SITE_ORIGIN/)
  })

  it('stops start-up when enabled and the origin is not trusted', () => {
    expect(() => assertSeoConfig({ ...enabled, WEB_TRUSTED_ORIGINS: undefined })).toThrow(
      /WEB_TRUSTED_ORIGINS/
    )
    expect(() =>
      assertSeoConfig({ ...enabled, WEB_TRUSTED_ORIGINS: 'https://other.example.com' })
    ).toThrow(/WEB_TRUSTED_ORIGINS/)
  })
})
