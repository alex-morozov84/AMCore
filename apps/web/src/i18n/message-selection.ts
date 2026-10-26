import type { AbstractIntlMessages, Messages } from 'next-intl'

export type MessageNamespace = Extract<keyof Messages, string>

export const ROOT_CLIENT_NAMESPACES = ['common', 'errors', 'validation', 'locale'] as const

/** Validate the list before constructing an object, which would discard duplicate keys. */
export function selectMessageNamespaces(
  messages: AbstractIntlMessages,
  namespaces: readonly MessageNamespace[]
): AbstractIntlMessages {
  if (!namespaces.length) throw new Error('ClientMessages requires a namespace selection')
  const names = new Set<string>()
  for (const name of namespaces) {
    if (names.has(name)) throw new Error(`ClientMessages repeats namespace: ${name}`)
    if (!Object.hasOwn(messages, name)) throw new Error(`ClientMessages unknown namespace: ${name}`)
    names.add(name)
  }
  return Object.fromEntries(namespaces.map((name) => [name, messages[name]]))
}

/** A section owns additions; it cannot replace a namespace inherited from its shell. */
export function mergeClientMessages(
  inherited: AbstractIntlMessages,
  additions: AbstractIntlMessages
): AbstractIntlMessages {
  for (const name of Object.keys(additions)) {
    if (Object.hasOwn(inherited, name)) {
      throw new Error(`ClientMessages shadows parent namespace: ${name}`)
    }
  }
  return { ...inherited, ...additions }
}
