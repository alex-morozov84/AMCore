import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'

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

export const metadata: Metadata = {
  title: 'AMCore',
  description: 'Production-oriented application starter for secure, modular products.',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    // suppressHydrationWarning: the theme-init script below sets the `dark`
    // class on this element before React hydrates, so its class attribute
    // legitimately differs from what the server rendered — see
    // docs/frontend/brand-theme-and-tokens.md.
    <html lang={locale} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Raw <script> (not next/script) as the first thing in <body>,
            deliberately — next/script's beforeInteractive strategy is loaded
            by Next's own client bootstrap chunk, which is fetched
            asynchronously and can run *after* the browser has already
            painted this page's initial content. A plain inline script tag
            has no such gap: the browser executes it synchronously as it
            parses the document, before anything after it can paint. See
            docs/frontend/brand-theme-and-tokens.md for the full reasoning. */}
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
