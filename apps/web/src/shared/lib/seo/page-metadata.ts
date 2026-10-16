import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import {
  DEFAULT_LOCALE,
  localizedFrontendUrl,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@amcore/shared'

import { getSiteOrigin, isIndexingEnabled } from './site-origin'

/**
 * This file is the only place in `apps/web/src` that may write a `robots` metadata key (a static
 * guard test enforces it). Next merges metadata shallowly, so a page-level `robots` object replaces
 * the layout's whole object; keeping every such value here makes "a page reopens indexing by
 * accident" impossible to write. A private page that wants an explicit close imports
 * `noindexMetadata`; a public page calls `buildPageMetadata`.
 */
export const noindexMetadata = { robots: { index: false, follow: false } } satisfies Metadata

/**
 * Site-wide defaults for the root layout. Takes no `locale` and no `params` on purpose: the
 * single-locale scaffold transform deletes both inside `generateMetadata`, and any other use of
 * them there would break a forked project. The root sets neither `alternates.canonical` nor
 * `openGraph.url`: a page that forgot them would inherit the home page's and be folded into it.
 */
export function rootSeoMetadata(siteName: string): Metadata {
  const origin = getSiteOrigin()
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    openGraph: { type: 'website', siteName },
    twitter: { card: 'summary' },
    ...noindexMetadata,
  }
}

/** `og:locale` wants `language_TERRITORY`. Add the territory of every locale a fork supports. */
const OPEN_GRAPH_LOCALES: Partial<Record<string, string>> = { en: 'en_US', ru: 'ru_RU' }

export interface PageMetadataInput {
  locale: SupportedLocale
  /** Path without the locale prefix: `/pricing`, or `''` for the home page. No query or hash. */
  path: string
  title: string
  description?: string
  /** Absolute URL, or a path resolved against the site origin. */
  image?: string
  type?: 'website' | 'article'
}

/**
 * Complete metadata for a public page. Every object that Next replaces on merge (`robots`,
 * `openGraph`, `twitter`, `alternates`) is returned whole. The page is open to search engines only
 * when `WEB_SEO_INDEXING=enabled` and `WEB_SITE_ORIGIN` is usable; the proxy additionally closes
 * every host other than the site's (`X-Robots-Tag`), and the most restrictive directive wins.
 * Without a usable origin no absolute URL (canonical, alternates, `og:url`, images) is emitted.
 */
export async function buildPageMetadata(input: PageMetadataInput): Promise<Metadata> {
  const { locale, path, title, description, image, type = 'website' } = input
  const origin = getSiteOrigin()
  const open = isIndexingEnabled() && origin !== null
  const t = await getTranslations({ locale, namespace: 'meta' })
  const urlFor = (target: SupportedLocale) =>
    origin ? localizedFrontendUrl(origin, target, path) : undefined
  const canonical = urlFor(locale)
  const ogLocale = OPEN_GRAPH_LOCALES[locale]
  const alternateLocales = SUPPORTED_LOCALES.filter((other) => other !== locale)
    .map((other) => OPEN_GRAPH_LOCALES[other])
    .filter((value): value is string => Boolean(value))
  const imageUrl = origin && image ? new URL(image, origin).toString() : undefined

  return {
    title,
    description,
    robots: { index: open, follow: open },
    ...(canonical && {
      alternates: {
        canonical,
        ...(SUPPORTED_LOCALES.length > 1 && {
          languages: {
            ...Object.fromEntries(SUPPORTED_LOCALES.map((other) => [other, urlFor(other)])),
            'x-default': urlFor(DEFAULT_LOCALE),
          },
        }),
      },
    }),
    openGraph: {
      type,
      title,
      description,
      siteName: t('title'),
      ...(canonical && { url: canonical }),
      ...(ogLocale && { locale: ogLocale }),
      ...(alternateLocales.length > 0 && { alternateLocale: alternateLocales }),
      ...(imageUrl && { images: [{ url: imageUrl }] }),
    },
    twitter: {
      card: imageUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
    },
  }
}
