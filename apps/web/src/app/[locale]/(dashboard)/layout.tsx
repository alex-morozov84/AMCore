import type { ReactNode } from 'react'

import { getOptionalSession } from '@/shared/api/bff/dal'
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

  return <AppShell email={email}>{children}</AppShell>
}
