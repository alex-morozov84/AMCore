/**
 * Message namespaces that only a nested provider below the root delivers to the browser.
 *
 * Messages handed to `NextIntlClientProvider` are serialized into every page's HTML/RSC
 * payload, so the root provider must not carry a large catalogue that only one route
 * subtree renders. Server Components keep reading the complete catalogue through
 * `getTranslations`; this list only narrows what reaches client components.
 */
export const ROUTE_SCOPED_NAMESPACES: readonly string[] = [
  'accountMfa',
  // AMCORE_CONSOLE_CLIENT_MESSAGES_START
  'console',
  // AMCORE_CONSOLE_CLIENT_MESSAGES_END
]
