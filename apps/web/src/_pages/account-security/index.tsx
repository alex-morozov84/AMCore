import type { ReactNode } from 'react'

import { AuthLocaleSwitcher as LocaleSwitcher } from '@/features/locale-switcher'

/** Content is injected by the app layer; no backend credentials cross this boundary. */
export function AccountSecurityPage({
  children,
  standalone = false,
}: {
  children: ReactNode
  standalone?: boolean
}) {
  if (!standalone) return children
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {children}
      <LocaleSwitcher />
    </main>
  )
}
