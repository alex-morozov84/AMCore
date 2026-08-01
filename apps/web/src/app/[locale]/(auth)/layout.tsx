'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { LocaleSwitcher } from '@/features'
import { useRouter } from '@/i18n/navigation'
import { useAuthStore } from '@/shared/store'
import { Spinner } from '@/shared/ui'

interface AuthLayoutProps {
  children: ReactNode
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  const router = useRouter()
  const status = useAuthStore((state) => state.status)

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/')
    }
  }, [status, router])

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (status === 'authenticated') {
    return null
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {children}
      <LocaleSwitcher />
    </main>
  )
}
