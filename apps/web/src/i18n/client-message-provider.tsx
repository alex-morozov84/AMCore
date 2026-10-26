'use client'

import type { ReactNode } from 'react'
import {
  type AbstractIntlMessages,
  NextIntlClientProvider,
  useLocale,
  useMessages,
} from 'next-intl'

import { mergeClientMessages } from './message-selection'

/** Private adapter: server composition passes selected additions, never a full catalogue. */
export function ClientMessageProvider({
  messages,
  children,
}: {
  messages: AbstractIntlMessages
  children: ReactNode
}) {
  const inherited = useMessages()
  const locale = useLocale()
  return (
    <NextIntlClientProvider locale={locale} messages={mergeClientMessages(inherited, messages)}>
      {children}
    </NextIntlClientProvider>
  )
}
