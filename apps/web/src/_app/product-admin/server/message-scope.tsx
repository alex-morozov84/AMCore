import type { ReactNode } from 'react'

import { ClientMessages } from '@/i18n/client-message-boundary'

export function ProductAdminMessages({ children }: { children: ReactNode }) {
  return <ClientMessages namespaces={['productAdmin']}>{children}</ClientMessages>
}
