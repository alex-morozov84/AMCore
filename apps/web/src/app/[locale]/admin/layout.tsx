import type { ReactNode } from 'react'
import { IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google'
import { notFound } from 'next/navigation'

import { hasCanonicalConsoleHost } from '@/shared/lib/console-host-guard'

export const dynamic = 'force-dynamic'

/**
 * Console-only "Control Room" typography. The fonts themselves load here,
 * not in `globals.css`, since that file sits outside the console's closed
 * ownership roots (`scripts/lib/operations-console-ownership-facts.mjs`):
 * a `next/font/google` call declared there has no seam covering its
 * removal when a downstream fork disables the console. `globals.css` only
 * carries a small `console.tokens`-seam-covered indirection
 * (`--font-console-heading`/`--font-console-mono`, both `var()` references
 * to the CSS variables these fonts set below) so the rest of the console UI
 * can use ordinary `font-console-heading`/`font-console-mono` Tailwind
 * utilities instead of an arbitrary-value class referencing the raw CSS
 * variable at every call site. Both subsets cover Cyrillic (verified
 * against this
 * repo's installed
 * `next/dist/compiled/@next/font/dist/google/font-data.json`), unlike the
 * originally pinned design's Space Grotesk, which does not.
 */
const consoleHeadingFont = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: 'variable',
  variable: '--console-font-heading',
  display: 'swap',
})
const consoleMonoFont = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: 'variable',
  variable: '--console-font-mono',
  display: 'swap',
})

export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await hasCanonicalConsoleHost())) notFound()
  return (
    <div
      className={`${consoleHeadingFont.variable} ${consoleMonoFont.variable} font-console-heading`}
    >
      {children}
    </div>
  )
}
