import type { AbstractIntlMessages } from 'next-intl'
import { getMessages } from 'next-intl/server'

import { ROUTE_SCOPED_NAMESPACES } from './route-scoped-namespaces'

import 'server-only'

/** The selected locale's messages without route-scoped namespaces, for the root provider. */
export async function getClientMessages(): Promise<AbstractIntlMessages> {
  const messages: AbstractIntlMessages = await getMessages()
  return Object.fromEntries(
    Object.entries(messages).filter(([namespace]) => !ROUTE_SCOPED_NAMESPACES.includes(namespace))
  )
}
