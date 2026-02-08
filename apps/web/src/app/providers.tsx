'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { QueryProvider } from '@/shared/api'
import { configureZodLocale } from '@/shared/lib'
import { PWAProvider } from '@/shared/pwa'
import { AuthStoreProvider, UIStoreProvider } from '@/shared/store'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  // Configure Zod locale on mount (Zod v4 native i18n)
  useEffect(() => {
    configureZodLocale()
  }, [])

  return (
    <QueryProvider>
      <AuthStoreProvider>
        <UIStoreProvider>
          <PWAProvider>{children}</PWAProvider>
        </UIStoreProvider>
      </AuthStoreProvider>
    </QueryProvider>
  )
}
