// Text fixture for project-plan-web-root-layout.mjs's move-and-rewrite step
// -- the single-static-locale rewrite of apps/web/src/app/[locale]/layout.tsx.
// Split out to stay under the repo's ~150-line-per-file guidance, same
// reason as project-plan-web-root-layout-before.mjs. Import order (DEFAULT_LOCALE
// before CSPProvider) verified empirically (real eslint --fix against a
// disposable copy at the real apps/web/src/app/layout.tsx path) rather than
// guessed -- see project-plan-web-nav-links.mjs's header for why that matters.
export const ROOT_LAYOUT_AFTER = `import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { CSPProvider } from '@base-ui/react/csp-provider'

import { getThemeInitScript } from '@/shared/lib'
import { NONCE_REQUEST_HEADER } from '@/shared/lib/csp/constants'

import { Providers } from './providers'

import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'cyrillic'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin', 'cyrillic'],
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: 'meta' })

  return {
    title: t('title'),
    description: t('description'),
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Track 3 PR2 (\`ai/models-talk.md\` FINAL PLAN §3): the per-request CSP
  // nonce \`src/proxy.ts\` generated, read via \`headers()\` rather than a prop
  // — this is the documented Next.js pattern (content-security-policy.md)
  // and keeps every route under this layout on the same mechanism. Calling
  // \`headers()\` opts this layout into dynamic rendering — the accepted
  // trade-off from the owner decision that AMCore's core routes prefer
  // strict security over static optimization (\`ai/models-talk.md\` FINAL
  // PLAN §0.3).
  const nonce = (await headers()).get(NONCE_REQUEST_HEADER) ?? undefined

  return (
    // suppressHydrationWarning: the theme-init script below sets the \`dark\`
    // class on this element before React hydrates, so its class attribute
    // legitimately differs from what the server rendered — see
    // docs/frontend/brand-theme-and-tokens.md.
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
      <body className={\`\${geistSans.variable} \${geistMono.variable} antialiased\`}>
        {/* Raw <script> (not next/script) as the first thing in <body>,
            deliberately — next/script's beforeInteractive strategy is loaded
            by Next's own client bootstrap chunk, which is fetched
            asynchronously and can run *after* the browser has already
            painted this page's initial content. A plain inline script tag
            has no such gap: the browser executes it synchronously as it
            parses the document, before anything after it can paint. See
            docs/frontend/brand-theme-and-tokens.md for the full reasoning.
            \`nonce\` is required once CSP enforces script-src without
            'unsafe-inline' (Track 3) — harmless to set under Report-Only too. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
        {/* Threads the same nonce to the handful of Base UI components that
            render inline <style>/<script> tags (ScrollArea, Select with
            alignItemWithTrigger, Tabs.Indicator, Slider.Thumb) — none in use
            today, but adding one later without this wrapper would silently
            violate CSP. See docs/frontend/ CSP guide (Track 3 PR4). */}
        <CSPProvider nonce={nonce}>
          {/* Rendered from a Server Component, so locale/messages/formats/timeZone
              are inherited from \`i18n/request.ts\` — do not pass them by hand. */}
          <NextIntlClientProvider>
            <Providers>{children}</Providers>
          </NextIntlClientProvider>
        </CSPProvider>
      </body>
    </html>
  )
}
`
