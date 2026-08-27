// init:project --mode=single: the root layout. Split from
// project-plan-web-layout.mjs (which now covers (auth)/layout.tsx and the
// OAuth callback route) to stay under the repo's ~150-line-per-file
// guidance — this one file's literal before/after text alone was over it.
import path from 'node:path'
import { moveAndRewriteStep } from './init-engine.mjs'

const LOCALE_APP = 'apps/web/src/app/[locale]'
const APP = 'apps/web/src/app'

const ROOT_LAYOUT_BEFORE = `import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { resolveLocaleParam } from '@/i18n/params'
import { routing } from '@/i18n/routing'
import { getThemeInitScript } from '@/shared/lib'

import { Providers } from './providers'

import '../globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'cyrillic'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin', 'cyrillic'],
})

type LocaleParams = { locale: string }

/**
 * Pre-render every locale at build time instead of resolving them on demand.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>
}): Promise<Metadata> {
  const locale = await resolveLocaleParam(params)
  const t = await getTranslations({ locale, namespace: 'meta' })

  return {
    title: t('title'),
    description: t('description'),
  }
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<LocaleParams>
}>) {
  const locale = await resolveLocaleParam(params)

  // Must run before any other next-intl call in this subtree, otherwise the
  // locale is read from the request headers and the route silently opts out of
  // static rendering.
  setRequestLocale(locale)

  return (
    // suppressHydrationWarning: the theme-init script below sets the \`dark\`
    // class on this element before React hydrates, so its class attribute
    // legitimately differs from what the server rendered — see
    // docs/frontend/brand-theme-and-tokens.md.
    <html lang={locale} suppressHydrationWarning>
      <body className={\`\${geistSans.variable} \${geistMono.variable} antialiased\`}>
        {/* Raw <script> (not next/script) as the first thing in <body>,
            deliberately — next/script's beforeInteractive strategy is loaded
            by Next's own client bootstrap chunk, which is fetched
            asynchronously and can run *after* the browser has already
            painted this page's initial content. A plain inline script tag
            has no such gap: the browser executes it synchronously as it
            parses the document, before anything after it can paint. See
            docs/frontend/brand-theme-and-tokens.md for the full reasoning. */}
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
        {/* Rendered from a Server Component, so locale/messages/formats/timeZone
            are inherited from \`i18n/request.ts\` — do not pass them by hand. */}
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
`

const ROOT_LAYOUT_AFTER = `import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { DEFAULT_LOCALE } from '@amcore/shared'

import { getThemeInitScript } from '@/shared/lib'

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
  const t = await getTranslations({ namespace: 'meta' })

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
            docs/frontend/brand-theme-and-tokens.md for the full reasoning. */}
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
        {/* Rendered from a Server Component, so locale/messages/formats/timeZone
            are inherited from \`i18n/request.ts\` — do not pass them by hand. */}
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
`

export function buildWebRootLayoutSteps(root) {
  return [
    moveAndRewriteStep(
      path.join(root, LOCALE_APP, 'layout.tsx'),
      path.join(root, APP, 'layout.tsx'),
      { expectedBefore: ROOT_LAYOUT_BEFORE, after: ROOT_LAYOUT_AFTER },
      'move and rewrite the root layout for a single static locale'
    ),
  ]
}
