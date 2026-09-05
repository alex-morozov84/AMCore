'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { QueryProvider } from '@/shared/api'
import { PWAProvider } from '@/shared/pwa'
import { ThemeProvider } from '@/shared/store'
import { Toaster } from '@/shared/ui/toast'

import '@/shared/lib/zod-jitless'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  const t = useTranslations('common')

  return (
    <ThemeProvider>
      <QueryProvider>
        <PWAProvider>{children}</PWAProvider>
        <Toaster closeLabel={t('close')} />
      </QueryProvider>
    </ThemeProvider>
  )
}
