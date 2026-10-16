import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { getPublicPages } from '@/_app/seo/public-pages'
import { buildSitemap } from '@/shared/lib/seo/crawler-files'
import { isIndexingEffective } from '@/shared/lib/seo/indexing'
import { getSiteOrigin } from '@/shared/lib/seo/site-origin'

// The 404 is decided AFTER a request-time read of the `Host` header. That keeps the route dynamic
// (the runtime environment applies) and was verified to answer HTTP 404; a bare `notFound()` with
// no request read would be evaluated at build time and was not tested. Closed site or no public
// pages: there is no sitemap, so the honest answer is 404 rather than an empty file.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get('host')
  const origin = getSiteOrigin()
  if (!origin || !isIndexingEffective(host)) notFound()
  const pages = await getPublicPages()
  if (pages.length === 0) notFound()
  return buildSitemap(origin, pages)
}
