import { createNavigation } from 'next-intl/navigation'

import { routing } from './routing'

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
  createNavigation(routing)
