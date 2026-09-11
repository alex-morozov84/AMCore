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
  /** CSP nonce from `[locale]/layout.tsx` — threaded to `QueryProvider` so its
   * `ReactQueryDevtools` instance can nonce its inline styles instead of
   * violating `style-src-elem` in dev. */
  nonce?: string
}

export function Providers({ children, nonce }: ProvidersProps) {
  const t = useTranslations('common')

  return (
    <ThemeProvider>
      <QueryProvider nonce={nonce}>
        <PWAProvider>{children}</PWAProvider>
        <Toaster closeLabel={t('close')} />
      </QueryProvider>
    </ThemeProvider>
  )
}
