import { createNavigation } from 'next-intl/navigation'
import { defineRouting } from 'next-intl/routing'
import { SUPPORTED_LOCALES } from '@amcore/shared'

import { routing } from './routing'

/**
 * Routing used only to *build* links and redirects. With one served locale the public
 * URLs carry no prefix (`next.config.ts` adds the locale internally), so the helpers
 * must emit bare paths; `'never'` does exactly that in `createNavigation` and needs no
 * middleware. The middleware itself keeps using `routing` (`'always'`) and is not
 * called at all in that case (`src/proxy.ts`): next-intl's own `'never'` mode rewrites
 * inside the middleware, which Next's standalone server does not apply (see
 * `routing.ts`).
 */
const navigationRouting = defineRouting({
  locales: routing.locales,
  defaultLocale: routing.defaultLocale,
  localePrefix: SUPPORTED_LOCALES.length === 1 ? 'never' : 'always',
  alternateLinks: false,
})

/**
 * Locale-aware replacements for `next/link` and `next/navigation`.
 *
 * **Always import navigation from here, never from `next/link` or
 * `next/navigation`.** The Next.js originals know nothing about the `[locale]`
 * segment: they silently drop the prefix, so a Russian user clicking a link
 * lands back on the English route with no error anywhere. It is a
 * fail-silent class of bug, which is why an ESLint rule bans the raw imports
 * rather than leaving it to review.
 *
 * `redirect`/`permanentRedirect` are re-exported for Server Components;
 * `useRouter`/`usePathname` for Client Components.
 */
export const { Link, redirect, permanentRedirect, usePathname, useRouter, getPathname } =
  createNavigation(navigationRouting)
