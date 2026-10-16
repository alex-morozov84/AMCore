import type { MetadataRoute } from 'next'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'

import { type PageQuery, pageUrl } from './page-url'

/** One public page of the product, as listed in `_app/seo/public-pages.ts`. */
export interface PublicPage {
  /** Path without the locale prefix: `/pricing`, or `''` for the home page. No query or hash. */
  path: string
  /** The page's own query, such as `{ page: '2' }` for a listing; see `PageMetadataInput.query`. */
  query?: PageQuery
  lastModified?: Date | string
  changeFrequency?: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>
  priority?: number
}

/**
 * `robots.txt` content. It never lists private paths or the Console slug: privacy comes from
 * `noindex` plus authentication, and a `Disallow` would hide the `noindex` from Google and Yandex,
 * which must be able to crawl a page to see it. The `Sitemap` line appears only when there is a
 * sitemap to point at. It emits no `host` directive: Yandex's current documentation does not list
 * it and Google ignores it. A fork that needs Yandex `Clean-param` adds it through `rules[].other`
 * (see `docs/frontend/seo.md`).
 */
export function buildRobots(input: {
  origin: string | null
  hasSitemap: boolean
}): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    ...(input.hasSitemap && input.origin ? { sitemap: `${input.origin}/sitemap.xml` } : {}),
  }
}

/**
 * Sitemap entries: every public page once per locale, each listing all locale variants and
 * `x-default` (Google reads sitemap alternates; Yandex does not, so pages also publish hreflang
 * in their `<head>` through `buildPageMetadata`). A single-locale fork gets no alternates.
 */
export function buildSitemap(origin: string, pages: readonly PublicPage[]): MetadataRoute.Sitemap {
  return pages.flatMap((page) => {
    const languages =
      SUPPORTED_LOCALES.length > 1
        ? {
            ...Object.fromEntries(
              SUPPORTED_LOCALES.map((locale) => [
                locale,
                pageUrl(origin, locale, page.path, page.query),
              ])
            ),
            'x-default': pageUrl(origin, DEFAULT_LOCALE, page.path, page.query),
          }
        : undefined
    return SUPPORTED_LOCALES.map((locale) => ({
      url: pageUrl(origin, locale, page.path, page.query),
      ...(page.lastModified !== undefined && { lastModified: page.lastModified }),
      ...(page.changeFrequency && { changeFrequency: page.changeFrequency }),
      ...(page.priority !== undefined && { priority: page.priority }),
      ...(languages && { alternates: { languages } }),
    }))
  })
}
