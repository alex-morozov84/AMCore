'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { QueryProvider } from '@/shared/api'
import { PWAProvider } from '@/shared/pwa'
import { ThemeProvider, UIStoreProvider } from '@/shared/store'
import { Toaster } from '@/shared/ui/toast'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  const t = useTranslations('common')

  return (
    <ThemeProvider>
      <QueryProvider>
        <UIStoreProvider>
          <PWAProvider>{children}</PWAProvider>
        </UIStoreProvider>
        <Toaster closeLabel={t('close')} />
      </QueryProvider>
    </ThemeProvider>
  )
}
