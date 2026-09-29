import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl, type SupportedLocale } from '@amcore/shared'

import { activeTarget } from '../support/managed-target.mjs'

/** Use the admitted generated checkout's actual catalogues and route topology. */
export function organizationUi(locale: SupportedLocale = DEFAULT_LOCALE) {
  const target = activeTarget()
  const messages = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
  ).organizationAccess as Record<string, string>
  return {
    text: (key: string) => messages[key]!,
    open: (name: string) => messages.openNamed!.replace('{name}', name),
    path: (suffix = '') =>
      new URL(localizedFrontendUrl(target.origins.product, locale, `organizations${suffix}`))
        .pathname,
  }
}
