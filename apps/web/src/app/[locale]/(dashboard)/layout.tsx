import type { ReactNode } from 'react'

import { LogoutButton } from '@/features/auth/logout'
import { LocaleSwitcher } from '@/features/locale-switcher'
import { getOptionalSession } from '@/shared/api/bff/dal'

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
 * catch only protects the *header's* rendering, not the real gate.
 */
export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  let email: string | undefined
  try {
    const session = await getOptionalSession()
    email = session?.user.email
  } catch (error) {
    console.error('[dashboard layout] session read failed, degrading header only', error)
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <span className="font-semibold">AMCore</span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{email}</span>
            <LocaleSwitcher />
            <LogoutButton variant="ghost" showText={false} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  )
}
