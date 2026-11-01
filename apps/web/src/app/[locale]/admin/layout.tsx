import type { ReactNode } from 'react'
import { IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google'
import { notFound } from 'next/navigation'

import { ClientMessages } from '@/i18n/client-message-boundary'
import { hasCanonicalConsoleHost } from '@/shared/lib/console-host-guard'
import { noindexMetadata } from '@/shared/lib/seo/page-metadata'

export const dynamic = 'force-dynamic'
// The Console must stay closed to search engines even if the root default ever changes. This is its
// only page-level control: it has no static header, because the slug lives in a Console-owned file
// that a fork without the Console deletes (docs/frontend/seo.md).
export const metadata = noindexMetadata

/**
 * Console-only "Control Room" typography. The fonts themselves load here,
 * not in `globals.css`, so the Console's font loading stays beside the Console
 * routes. `globals.css` only carries a small indirection
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
      <ClientMessages namespaces={['console', 'sessions']}>{children}</ClientMessages>
    </div>
  )
}
