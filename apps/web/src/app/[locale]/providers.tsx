'use client'

import type { ReactNode } from 'react'

import { QueryProvider } from '@/shared/api'
import { PWAProvider } from '@/shared/pwa'
import { ThemeProvider, UIStoreProvider } from '@/shared/store'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <UIStoreProvider>
          <PWAProvider>{children}</PWAProvider>
        </UIStoreProvider>
      </QueryProvider>
    </ThemeProvider>
  )
}
