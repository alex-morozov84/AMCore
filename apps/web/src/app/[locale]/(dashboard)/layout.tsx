'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { LogoutButton } from '@/features/auth/logout'
import { LocaleSwitcher } from '@/features/locale-switcher'
import { useRouter } from '@/i18n/navigation'
import { useAuthStore } from '@/shared/store'
import { Spinner } from '@/shared/ui/spinner'

interface DashboardLayoutProps {
  children: ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter()
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
    }
  }, [status, router])

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return null
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <span className="font-semibold">AMCore</span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <LocaleSwitcher />
            <LogoutButton variant="ghost" showText={false} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </div>
  )
}
