import type { ReactNode } from 'react'

import { LocaleSwitcher } from '@/features/locale-switcher'

interface AuthLayoutProps {
  children: ReactNode
}

/**
 * The "already authenticated? redirect to /" check lives in each page
 * (`login/page.tsx`, `register/page.tsx` — `redirectIfAuthenticated`), not
 * here: same partial-rendering reasoning as `(dashboard)`'s layout/page
 * split (see `dal.ts`), just lower-stakes — there's no protected data to
 * leak either way, only a redundant form render if it's ever missed.
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {children}
      <LocaleSwitcher />
    </main>
  )
}
