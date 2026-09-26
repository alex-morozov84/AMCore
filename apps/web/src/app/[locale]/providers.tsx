'use client'

// Configure Zod before imported client modules construct schemas under CSP.
// eslint-disable-next-line simple-import-sort/imports
import '@/shared/lib/zod-jitless'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { QueryProvider } from '@/shared/api'
import { DeploymentVersionCheck } from '@/shared/lib/deployment-version/DeploymentVersionCheck'
import { PWAProvider } from '@/shared/pwa'
import { ThemeProvider } from '@/shared/store'
import { Toaster } from '@/shared/ui/toast'

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
      <DeploymentVersionCheck />
      <QueryProvider nonce={nonce}>
        <PWAProvider>{children}</PWAProvider>
        <Toaster closeLabel={t('close')} />
      </QueryProvider>
    </ThemeProvider>
  )
}
