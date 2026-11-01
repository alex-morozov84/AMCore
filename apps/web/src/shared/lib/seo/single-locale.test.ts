import { DEFAULT_LOCALE } from '@amcore/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

// With exactly one supported locale there is no locale prefix in URLs and no alternates anywhere.
// The prefix rule itself belongs to `packages/shared` (`localizedFrontendUrl`, tested there
// against its own locale list), so this test replaces it with the single-locale behaviour and
// checks what the SEO code does with one locale: it must publish no `languages`, no `x-default`
// and no `alternateLocale`. The locale is taken from the shared default, never spelled out.
vi.mock('@amcore/shared', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@amcore/shared')),
  SUPPORTED_LOCALES: ['single'],
  localizedFrontendUrl: (
    base: string,
    _locale: string,
    path = '',
    query?: Record<string, string>
  ) => {
    const search = new URLSearchParams(query).toString()
    return `${base}${path ? `/${path.replace(/^\/+/, '')}` : ''}${search ? `?${search}` : ''}`
  },
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

import { buildSitemap } from './crawler-files'
import { buildPageMetadata } from './page-metadata'

afterEach(() => vi.unstubAllEnvs())

describe('a single-locale fork', () => {
  it('builds unprefixed canonical URLs and publishes no alternates or alternate locales', async () => {
    vi.stubEnv('WEB_SEO_INDEXING', 'enabled')
    vi.stubEnv('WEB_SITE_ORIGIN', 'https://shop.example.com')
    const metadata = await buildPageMetadata({
      locale: DEFAULT_LOCALE,
      path: '/pricing',
      title: 'Pricing',
    })
    expect(metadata.alternates).toEqual({ canonical: 'https://shop.example.com/pricing' })
    expect(metadata.openGraph).not.toHaveProperty('alternateLocale')
  })

  it("keeps a page's own query in the canonical", async () => {
    vi.stubEnv('WEB_SEO_INDEXING', 'enabled')
    vi.stubEnv('WEB_SITE_ORIGIN', 'https://shop.example.com')
    const metadata = await buildPageMetadata({
      locale: DEFAULT_LOCALE,
      path: '/catalog',
      query: { page: '2' },
      title: 'Catalog',
    })
    expect(metadata.alternates).toEqual({ canonical: 'https://shop.example.com/catalog?page=2' })
  })

  it('lists each page once, unprefixed, without alternates', () => {
    const entries = buildSitemap('https://shop.example.com', [{ path: '/pricing' }])
    expect(entries).toEqual([{ url: 'https://shop.example.com/pricing' }])
  })
})
