import { DEFAULT_LOCALE, localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildPageMetadata, noindexMetadata, rootSeoMetadata } from './page-metadata'

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => (key === 'title' ? 'Shop' : key),
}))

// Expectations are derived from the shared locale set, never spelled out: a fork scaffolded with
// one locale type-checks and runs this file too (a literal 'ru' or 'en' would not compile there).
const ORIGIN = 'https://shop.example.com'
const MULTI = SUPPORTED_LOCALES.length > 1
const OPEN_GRAPH: Record<string, string | undefined> = { en: 'en_US', ru: 'ru_RU' }

type Query = Record<string, string>
const url = (path: string, query?: Query, locale: string = DEFAULT_LOCALE) =>
  localizedFrontendUrl(ORIGIN, locale as typeof DEFAULT_LOCALE, path, query)
const languages = (path: string, query?: Query) =>
  Object.fromEntries([
    ...SUPPORTED_LOCALES.map((locale) => [locale, url(path, query, locale)]),
    ['x-default', url(path, query)],
  ])
const input = { locale: DEFAULT_LOCALE, path: '/pricing', title: 'Pricing', description: 'Plans' }

function stubSite(enabled: boolean, origin: string | undefined = ORIGIN) {
  vi.stubEnv('WEB_SEO_INDEXING', enabled ? 'enabled' : 'disabled')
  vi.stubEnv('WEB_SITE_ORIGIN', origin ?? '')
}

afterEach(() => vi.unstubAllEnvs())

describe('noindexMetadata', () => {
  it('closes the page', () => {
    expect(noindexMetadata).toEqual({ robots: { index: false, follow: false } })
  })
})

describe('rootSeoMetadata', () => {
  it('sets the base, site defaults and a closed default, but no canonical or og:url', () => {
    stubSite(true)
    const metadata = rootSeoMetadata('Shop')
    expect(metadata.metadataBase?.toString()).toBe(`${ORIGIN}/`)
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.openGraph).toEqual({ type: 'website', siteName: 'Shop' })
    expect(metadata.alternates).toBeUndefined()
    expect(metadata.openGraph).not.toHaveProperty('url')
  })

  it('omits the base when the origin is unusable', () => {
    stubSite(true, 'shop.example.com')
    expect(rootSeoMetadata('Shop').metadataBase).toBeUndefined()
  })
})

describe('buildPageMetadata', () => {
  it('opens the page and builds absolute, locale-prefixed URLs when indexing is enabled', async () => {
    stubSite(true)
    const metadata = await buildPageMetadata(input)
    expect(metadata.title).toBe('Pricing')
    expect(metadata.robots).toEqual({ index: true, follow: true })
    expect(metadata.alternates).toEqual({
      canonical: url('/pricing'),
      ...(MULTI && { languages: languages('/pricing') }),
    })
    const ogLocale = OPEN_GRAPH[DEFAULT_LOCALE]
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'Shop',
      url: url('/pricing'),
      ...(ogLocale && { locale: ogLocale }),
    })
    expect(metadata.twitter).toMatchObject({ card: 'summary', title: 'Pricing' })
  })

  it('lists the other supported locales as alternate Open Graph locales, and none for one locale', async () => {
    stubSite(true)
    const metadata = await buildPageMetadata(input)
    const others = SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE)
      .map((locale) => OPEN_GRAPH[locale])
      .filter(Boolean)
    if (others.length > 0) expect(metadata.openGraph).toMatchObject({ alternateLocale: others })
    else expect(metadata.openGraph).not.toHaveProperty('alternateLocale')
  })

  it.each([
    ['indexing disabled', false],
    ['indexing unset', false],
  ])('keeps the page closed with %s but still builds the URLs', async (_name, enabled) => {
    stubSite(enabled)
    const metadata = await buildPageMetadata(input)
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates?.canonical).toBe(url('/pricing'))
  })

  it('stays closed and emits no absolute URL when enabled with an unusable origin', async () => {
    stubSite(true, 'not a url')
    const metadata = await buildPageMetadata({ ...input, image: '/og.png' })
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates).toBeUndefined()
    expect(metadata.openGraph).not.toHaveProperty('url')
    expect(metadata.openGraph).not.toHaveProperty('images')
    expect(metadata.twitter).not.toHaveProperty('images')
  })

  it('resolves a relative image against the origin and uses the large card', async () => {
    stubSite(true)
    const metadata = await buildPageMetadata({ ...input, image: '/og/pricing.png' })
    expect(metadata.openGraph).toMatchObject({ images: [{ url: `${ORIGIN}/og/pricing.png` }] })
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      images: [`${ORIGIN}/og/pricing.png`],
    })
  })

  it('builds the home page without a trailing slash', async () => {
    stubSite(true)
    const metadata = await buildPageMetadata({ ...input, path: '' })
    expect(metadata.alternates?.canonical).toBe(url(''))
    expect(String(metadata.alternates?.canonical).endsWith('/')).toBe(false)
  })

  it('returns whole objects for every key Next replaces on merge', async () => {
    stubSite(true)
    const metadata = await buildPageMetadata({ ...input, image: '/og.png' })
    for (const key of ['robots', 'openGraph', 'twitter', 'alternates'] as const)
      expect(metadata[key], key).toBeDefined()
    expect(metadata.openGraph).toMatchObject({
      type: expect.any(String),
      siteName: expect.any(String),
      title: 'Pricing',
      url: expect.any(String),
    })
  })

  describe('the page own query (pagination)', () => {
    it('puts the page number into the canonical, the language variants and og:url', async () => {
      stubSite(true)
      const query = { page: '2' }
      const metadata = await buildPageMetadata({ ...input, path: '/catalog', query })
      expect(metadata.alternates?.canonical).toBe(url('/catalog', query))
      expect(String(metadata.alternates?.canonical)).toMatch(/\/catalog\?page=2$/)
      if (MULTI) expect(metadata.alternates?.languages).toEqual(languages('/catalog', query))
      expect(metadata.openGraph).toMatchObject({ url: url('/catalog', query) })
    })

    it('has no query when none is passed, so filters and sorting fold into the listing', async () => {
      stubSite(true)
      const metadata = await buildPageMetadata({ ...input, path: '/catalog' })
      expect(String(metadata.alternates?.canonical)).not.toContain('?')
    })

    it('writes the keys in alphabetical order so one page has one canonical string', async () => {
      stubSite(true)
      const metadata = await buildPageMetadata({
        ...input,
        path: '/catalog',
        query: { page: '2', brand: 'acme' },
      })
      expect(String(metadata.alternates?.canonical)).toMatch(/\?brand=acme&page=2$/)
    })

    it('does not add a query to a closed page without an origin', async () => {
      stubSite(true, 'not a url')
      const metadata = await buildPageMetadata({ ...input, path: '/catalog', query: { page: '2' } })
      expect(metadata.alternates).toBeUndefined()
    })
  })
})
