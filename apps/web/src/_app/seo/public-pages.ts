import type { PublicPage } from '@/shared/lib/seo/crawler-files'

/**
 * The public pages of this product: the one list the sitemap is built from.
 *
 * AMCore ships it empty: it has no public pages of its own, so a starter or CRM serves no
 * `sitemap.xml` (404) and `robots.txt` has no `Sitemap:` line. A fork with a public site adds each
 * page here AND gives the page `generateMetadata` built with `buildPageMetadata`; the guide
 * `docs/frontend/seo.md` has the steps, the checks and the traps. It is `async` so a fork can read
 * its pages from a database. Paths are locale-less: `'/pricing'`, or `''` for the home page.
 *
 * Whether a page listed here also calls the helper is a convention, not a test: dynamic routes
 * cannot be enumerated statically. A listed page that forgot the helper stays `noindex` (safe) but
 * shows up in the sitemap, which Search Console reports as a warning.
 */
export async function getPublicPages(): Promise<readonly PublicPage[]> {
  return []
}
