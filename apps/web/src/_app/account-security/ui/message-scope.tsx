'use client'

import type { ReactNode } from 'react'
import {
  type AbstractIntlMessages,
  NextIntlClientProvider,
  useLocale,
  useMessages,
} from 'next-intl'

export function AccountMfaMessages({
  messages,
  children,
}: {
  messages: AbstractIntlMessages
  children: ReactNode
}) {
  const inherited = useMessages()
  const locale = useLocale()
  return (
    <NextIntlClientProvider locale={locale} messages={{ ...inherited, accountMfa: messages }}>
      {children}
    </NextIntlClientProvider>
  )
}
