import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildPageMetadata, noindexMetadata, rootSeoMetadata } from './page-metadata'

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => (key === 'title' ? 'Shop' : key),
}))

function stubSite(enabled: boolean, origin: string | undefined = 'https://shop.example.com') {
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
    expect(metadata.metadataBase?.toString()).toBe('https://shop.example.com/')
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
  const input = { locale: 'ru', path: '/pricing', title: 'Pricing', description: 'Plans' } as const

  it('opens the page and builds absolute, locale-prefixed URLs when indexing is enabled', async () => {
    stubSite(true)
    const metadata = await buildPageMetadata(input)
    expect(metadata.title).toBe('Pricing')
    expect(metadata.robots).toEqual({ index: true, follow: true })
    expect(metadata.alternates).toEqual({
      canonical: 'https://shop.example.com/ru/pricing',
      languages: {
        en: 'https://shop.example.com/en/pricing',
        ru: 'https://shop.example.com/ru/pricing',
        'x-default': 'https://shop.example.com/en/pricing',
      },
    })
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'Shop',
      url: 'https://shop.example.com/ru/pricing',
      locale: 'ru_RU',
      alternateLocale: ['en_US'],
    })
    expect(metadata.twitter).toMatchObject({ card: 'summary', title: 'Pricing' })
  })

  it.each([
    ['indexing disabled', false, 'https://shop.example.com'],
    ['indexing unset', false, 'https://shop.example.com'],
  ])('keeps the page closed with %s but still builds the URLs', async (_name, enabled, origin) => {
    stubSite(enabled, origin)
    const metadata = await buildPageMetadata(input)
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates?.canonical).toBe('https://shop.example.com/ru/pricing')
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
    expect(metadata.openGraph).toMatchObject({
      images: [{ url: 'https://shop.example.com/og/pricing.png' }],
    })
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      images: ['https://shop.example.com/og/pricing.png'],
    })
  })

  it('builds the home page without a trailing slash', async () => {
    stubSite(true)
    const metadata = await buildPageMetadata({ ...input, locale: 'en', path: '' })
    expect(metadata.alternates?.canonical).toBe('https://shop.example.com/en')
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
})
