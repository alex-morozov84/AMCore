import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  type CatalogueLocale,
  DEFAULT_LOCALE,
  localizedFrontendUrl,
  productAdminPath,
} from '@amcore/shared'

import { activeTarget } from '../support/managed-target.mjs'

import { productAdministrationOrigin } from './helpers'

/** Use the admitted generated checkout's actual catalogues and route topology. */
export function organizationUi(locale: CatalogueLocale = DEFAULT_LOCALE) {
  const target = activeTarget()
  const catalogues = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
  )
  const messages = catalogues.organizationAccess as Record<string, string>
  const url = (suffix = '') =>
    localizedFrontendUrl(
      productAdministrationOrigin(),
      locale,
      productAdminPath(`/organizations${suffix}`)
    )
  return {
    text: (key: string) => messages[key]!,
    adminText: (key: string) => catalogues.productAdmin[key] as string,
    open: (name: string) => messages.openNamed!.replace('{name}', name),
    url,
    path: (suffix = '') => new URL(url(suffix)).pathname,
  }
}
