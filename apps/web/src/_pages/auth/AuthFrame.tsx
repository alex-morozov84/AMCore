import type { ReactNode } from 'react'

import { LocaleSwitcher } from '@/features/locale-switcher'

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {children}
      <LocaleSwitcher />
    </main>
  )
}
