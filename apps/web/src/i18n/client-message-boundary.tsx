import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'

import { ClientMessageProvider } from './client-message-provider'
import { getClientMessages } from './client-messages'
import { type MessageNamespace, ROOT_CLIENT_NAMESPACES } from './message-selection'

import 'server-only'

export async function RootClientMessages({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider messages={await getClientMessages(ROOT_CLIENT_NAMESPACES)}>
      {children}
    </NextIntlClientProvider>
  )
}

export async function ClientMessages({
  namespaces,
  children,
}: {
  namespaces: readonly MessageNamespace[]
  children: ReactNode
}) {
  return (
    <ClientMessageProvider messages={await getClientMessages(namespaces)}>
      {children}
    </ClientMessageProvider>
  )
}
