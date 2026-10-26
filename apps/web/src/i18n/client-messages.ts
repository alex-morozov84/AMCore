import type { AbstractIntlMessages } from 'next-intl'
import { getMessages } from 'next-intl/server'

import { type MessageNamespace, selectMessageNamespaces } from './message-selection'

import 'server-only'

/** A namespace reaches the browser only when its section explicitly selects it. */
export async function getClientMessages(
  namespaces: readonly MessageNamespace[]
): Promise<AbstractIntlMessages> {
  return selectMessageNamespaces(await getMessages(), namespaces)
}
