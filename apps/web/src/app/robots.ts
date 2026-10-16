import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'

import { getPublicPages } from '@/_app/seo/public-pages'
import { buildRobots } from '@/shared/lib/seo/crawler-files'
import { isIndexingEffective } from '@/shared/lib/seo/indexing'
import { getSiteOrigin } from '@/shared/lib/seo/site-origin'

// Reading the request `Host` makes this route answer per request, so the runtime environment
// (WEB_SEO_INDEXING, WEB_SITE_ORIGIN) applies and one built image serves staging and production.
// A route that read nothing from the request would be cached at build time with whatever the
// build environment held.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const effective = isIndexingEffective((await headers()).get('host'))
  const pages = effective ? await getPublicPages() : []
  return buildRobots({ origin: getSiteOrigin(), hasSitemap: pages.length > 0 })
}
