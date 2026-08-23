import type { ReactNode } from 'react'
import { cookies } from 'next/headers'

import { getOptionalSession } from '@/shared/api/bff/dal'
import { SIDEBAR_COOKIE_NAME } from '@/shared/ui/sidebar-cookie'
import { AppShell } from '@/widgets/app-shell'

interface DashboardLayoutProps {
  children: ReactNode
}

// See `page.tsx`'s identical export — this layout also reads `cookies()`
// (via `getOptionalSession()`) on every render.
export const dynamic = 'force-dynamic'

/**
 * Display-only — not the auth gate (`(dashboard)/page.tsx`'s own
 * `requireSession()` is). This read is wrapped locally so a Redis
 * blip degrades the header (no email shown) instead of crashing the whole
 * segment: `getOptionalSession()` is `cache()`-wrapped, so the page's own
 * `requireSession()` call in the same request still observes and correctly
 * surfaces the same underlying failure via `(dashboard)/error.tsx` — this
 * catch only protects the *shell's* rendering, not the real gate.
 */
export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  let email: string | undefined
  try {
    const session = await getOptionalSession()
    email = session?.user.email
  } catch (error) {
    console.error('[dashboard layout] session read failed, degrading shell only', error)
  }

  // `SidebarProvider` writes this cookie client-side on every toggle
  // (shared/ui/sidebar.tsx). Reading it here and passing it back in as
  // `defaultOpen` is what makes the collapsed/expanded choice survive a
  // reload — without this read, every render would silently discard it and
  // fall back to `SidebarProvider`'s own `defaultOpen={true}`. `undefined`
  // (no cookie yet, e.g. first visit) intentionally falls through to that
  // same default rather than being coerced to `false`.
  const sidebarCookie = (await cookies()).get(SIDEBAR_COOKIE_NAME)?.value
  const defaultSidebarOpen = sidebarCookie === undefined ? undefined : sidebarCookie === 'true'

  return (
    <AppShell email={email} defaultSidebarOpen={defaultSidebarOpen}>
      {children}
    </AppShell>
  )
}
