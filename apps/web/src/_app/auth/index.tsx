import type { ReactNode } from 'react'

import { AuthFrame } from '@/_pages/auth'
import { ClientMessages } from '@/i18n/client-message-boundary'

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ClientMessages namespaces={['auth']}>
      <AuthFrame>{children}</AuthFrame>
    </ClientMessages>
  )
}
