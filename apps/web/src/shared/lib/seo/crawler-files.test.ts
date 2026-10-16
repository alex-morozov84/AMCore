import { describe, expect, it } from 'vitest'

import { buildRobots, buildSitemap } from './crawler-files'

describe('buildRobots', () => {
  it('allows crawling and never lists a private path or the Console slug', () => {
    const robots = buildRobots({ origin: 'https://shop.example.com', hasSitemap: false })
    expect(robots).toEqual({ rules: { userAgent: '*', allow: '/' } })
    expect(JSON.stringify(robots)).not.toMatch(/disallow|admin|login|dashboard/i)
  })

  it('points at the sitemap on the site origin only when there is one', () => {
    expect(buildRobots({ origin: 'https://shop.example.com', hasSitemap: true })).toEqual({
      rules: { userAgent: '*', allow: '/' },
      sitemap: 'https://shop.example.com/sitemap.xml',
    })
    expect(buildRobots({ origin: null, hasSitemap: true })).not.toHaveProperty('sitemap')
  })

  it('emits no host directive', () => {
    expect(
      buildRobots({ origin: 'https://shop.example.com', hasSitemap: true })
    ).not.toHaveProperty('host')
  })
})

describe('buildSitemap', () => {
  const origin = 'https://shop.example.com'

  it('lists every page once per locale with all locale variants and x-default', () => {
    const entries = buildSitemap(origin, [{ path: '/pricing' }, { path: '' }])
    expect(entries.map((entry) => entry.url)).toEqual([
      'https://shop.example.com/en/pricing',
      'https://shop.example.com/ru/pricing',
      'https://shop.example.com/en',
      'https://shop.example.com/ru',
    ])
    expect(entries[0]?.alternates?.languages).toEqual({
      en: 'https://shop.example.com/en/pricing',
      ru: 'https://shop.example.com/ru/pricing',
      'x-default': 'https://shop.example.com/en/pricing',
    })
  })

  it('carries lastModified, changeFrequency and priority only when given', () => {
    const [plain, rich] = buildSitemap(origin, [
      { path: '/a' },
      { path: '/b', lastModified: '2026-01-02', changeFrequency: 'weekly', priority: 0.5 },
    ]).filter((entry) => entry.url.includes('/en/'))
    expect(plain).not.toHaveProperty('lastModified')
    expect(plain).not.toHaveProperty('priority')
    expect(rich).toMatchObject({
      lastModified: '2026-01-02',
      changeFrequency: 'weekly',
      priority: 0.5,
    })
  })

  it('is empty for an empty registry', () => {
    expect(buildSitemap(origin, [])).toEqual([])
  })
})
