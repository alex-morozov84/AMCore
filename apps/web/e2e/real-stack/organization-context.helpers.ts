import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_LOCALE,
  localizedFrontendUrl,
  productAdminPath,
  type SupportedLocale,
} from '@amcore/shared'

import { activeTarget } from '../support/managed-target.mjs'

/** Use the admitted generated checkout's actual catalogues and route topology. */
export function organizationUi(locale: SupportedLocale = DEFAULT_LOCALE) {
  const target = activeTarget()
  const catalogues = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
  )
  const messages = catalogues.organizationAccess as Record<string, string>
  return {
    text: (key: string) => messages[key]!,
    adminText: (key: string) => catalogues.productAdmin[key] as string,
    open: (name: string) => messages.openNamed!.replace('{name}', name),
    path: (suffix = '') =>
      new URL(
        localizedFrontendUrl(
          target.origins.product,
          locale,
          productAdminPath(`/organizations${suffix}`)
        )
      ).pathname,
  }
}
