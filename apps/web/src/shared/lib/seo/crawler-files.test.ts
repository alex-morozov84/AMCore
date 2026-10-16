import { DEFAULT_LOCALE, localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import { buildRobots, buildSitemap } from './crawler-files'

const origin = 'https://shop.example.com'
const MULTI = SUPPORTED_LOCALES.length > 1
const url = (path: string, locale: string, query?: Record<string, string>) =>
  localizedFrontendUrl(origin, locale as typeof DEFAULT_LOCALE, path, query)

describe('buildRobots', () => {
  it('allows crawling and never lists a private path or the Console slug', () => {
    const robots = buildRobots({ origin, hasSitemap: false })
    expect(robots).toEqual({ rules: { userAgent: '*', allow: '/' } })
    expect(JSON.stringify(robots)).not.toMatch(/disallow|admin|login|dashboard/i)
  })

  it('points at the sitemap on the site origin only when there is one', () => {
    expect(buildRobots({ origin, hasSitemap: true })).toEqual({
      rules: { userAgent: '*', allow: '/' },
      sitemap: `${origin}/sitemap.xml`,
    })
    expect(buildRobots({ origin: null, hasSitemap: true })).not.toHaveProperty('sitemap')
  })

  it('emits no host directive', () => {
    expect(buildRobots({ origin, hasSitemap: true })).not.toHaveProperty('host')
  })
})

// Expectations are derived from the shared locale set so a one-locale fork passes this file too.
describe('buildSitemap', () => {
  it('lists every page once per locale with all locale variants and x-default', () => {
    const entries = buildSitemap(origin, [{ path: '/pricing' }, { path: '' }])
    expect(entries.map((entry) => entry.url)).toEqual(
      ['/pricing', ''].flatMap((path) => SUPPORTED_LOCALES.map((locale) => url(path, locale)))
    )
    if (MULTI)
      expect(entries[0]?.alternates?.languages).toEqual({
        ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, url('/pricing', locale)])),
        'x-default': url('/pricing', DEFAULT_LOCALE),
      })
    else expect(entries[0]).not.toHaveProperty('alternates')
  })

  it('carries lastModified, changeFrequency and priority only when given', () => {
    const entries = buildSitemap(origin, [
      { path: '/a' },
      { path: '/b', lastModified: '2026-01-02', changeFrequency: 'weekly', priority: 0.5 },
    ])
    const firstOfEachPage = entries.filter((_, index) => index % SUPPORTED_LOCALES.length === 0)
    const [plain, rich] = firstOfEachPage
    expect(plain).not.toHaveProperty('lastModified')
    expect(plain).not.toHaveProperty('priority')
    expect(rich).toMatchObject({
      lastModified: '2026-01-02',
      changeFrequency: 'weekly',
      priority: 0.5,
    })
  })

  it("lists a page's own query in every URL and every alternate, keys sorted", () => {
    const entries = buildSitemap(origin, [
      { path: '/catalog', query: { page: '2', brand: 'acme' } },
    ])
    const query = { brand: 'acme', page: '2' }
    expect(entries.map((entry) => entry.url)).toEqual(
      SUPPORTED_LOCALES.map((locale) => url('/catalog', locale, query))
    )
    expect(entries[0]?.url).toMatch(/\?brand=acme&page=2$/)
    if (MULTI)
      expect(entries[0]?.alternates?.languages).toEqual({
        ...Object.fromEntries(
          SUPPORTED_LOCALES.map((locale) => [locale, url('/catalog', locale, query)])
        ),
        'x-default': url('/catalog', DEFAULT_LOCALE, query),
      })
  })

  it('is empty for an empty registry', () => {
    expect(buildSitemap(origin, [])).toEqual([])
  })
})
