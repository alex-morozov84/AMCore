import { afterEach, describe, expect, it, vi } from 'vitest'

// A fork scaffolded with `--mode=single` has exactly one supported locale: no locale prefix in
// URLs and no alternates anywhere. The prefix rule itself belongs to `packages/shared`
// (`localizedFrontendUrl`, tested there against its own locale list), so this test replaces it
// with the single-locale behaviour and checks what the SEO code does with one locale: it must
// publish no `languages`, no `x-default` and no `alternateLocale`.
vi.mock('@amcore/shared', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@amcore/shared')),
  SUPPORTED_LOCALES: ['en'],
  localizedFrontendUrl: (base: string, _locale: string, path = '') =>
    `${base}${path ? `/${path.replace(/^\/+/, '')}` : ''}`,
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
    const metadata = await buildPageMetadata({ locale: 'en', path: '/pricing', title: 'Pricing' })
    expect(metadata.alternates).toEqual({ canonical: 'https://shop.example.com/pricing' })
    expect(metadata.openGraph).not.toHaveProperty('alternateLocale')
  })

  it('lists each page once, unprefixed, without alternates', () => {
    const entries = buildSitemap('https://shop.example.com', [{ path: '/pricing' }])
    expect(entries).toEqual([{ url: 'https://shop.example.com/pricing' }])
  })
})
