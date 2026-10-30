import { cookies, headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'

import { AuthFrame } from '@/_pages/auth'
import { contextSessionBinding } from '@/shared/api/bff/context-session'
import { getOptionalSessionEntry } from '@/shared/api/bff/dal'
import { resolveProductWebContext } from '@/shared/api/bff/product-web-context.server'
import { productAdminOrigins } from '@/shared/lib/product-admin-config.server'

import { ProductAdminDenied } from '../ui/denied-page'

export async function ProductAdminDeniedPage({
  showOrganizationList = true,
}: { showOrganizationList?: boolean } = {}) {
  const t = await getTranslations('auth')
  return (
    <AuthFrame>
      <ProductAdminDenied
        siteOrigin={productAdminOrigins().site}
        logoutLabel={t('logout')}
        contextSession={await logoutIntent()}
        showOrganizationList={showOrganizationList}
      />
    </AuthFrame>
  )
}

export async function ProductAdminRecovery({
  showOrganizationList = true,
}: { showOrganizationList?: boolean } = {}) {
  const t = await getTranslations('auth')
  return (
    <ProductAdminDenied
      siteOrigin={productAdminOrigins().site}
      logoutLabel={t('logout')}
      contextSession={await logoutIntent()}
      showOrganizationList={showOrganizationList}
    />
  )
}

/** Reuse the request-memoized admission; no profile fetch or additional primary probe. */
async function logoutIntent(): Promise<string | undefined> {
  try {
    const context = resolveProductWebContext(await headers(), 'admin-auth')
    const entry = await getOptionalSessionEntry('admin-auth')
    const id = (await cookies()).get(context.cookieName)?.value
    return entry && id ? contextSessionBinding(id, entry) : undefined
  } catch {
    return undefined
  }
}
