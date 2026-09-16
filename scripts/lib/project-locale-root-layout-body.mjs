export const ROOT_METADATA_BODY = `export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: DEFAULT_LOCALE, namespace: 'meta' })

  return {
    title: t('title'),
    description: t('description'),
  }
}`

export const ROOT_LAYOUT_BODY = `export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The per-request CSP nonce \`src/proxy.ts\` generated, read via
  // \`headers()\` rather than a prop — this is the documented Next.js
  // pattern (content-security-policy.md) and keeps every route under this
  // layout on the same mechanism. Calling \`headers()\` opts this layout
  // into dynamic rendering — AMCore's core routes accept this
  // deliberately; see docs/frontend/browser-security-and-csp.md →
  // "Downstream forks: public/marketing routes and route scoping" for the
  // full trade-off and why it does not generalize to a public marketing
  // page added under this same layout.
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
            {/* Suspense: RouteProgressBar reads useSearchParams(). See
                docs/frontend/route-progress.md; disabled entirely (no DOM,
                listeners, or timers) when ROUTE_PROGRESS_ENABLED is false. */}
            {ROUTE_PROGRESS_ENABLED && (
              <Suspense fallback={null}>
                <RouteProgressBar />
              </Suspense>
            )}
            <Providers nonce={nonce}>{children}</Providers>
          </NextIntlClientProvider>
        </CSPProvider>
      </body>
    </html>
  )
}`
