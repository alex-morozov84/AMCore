import { getTranslations } from 'next-intl/server'

import { AuthFrame } from '@/_pages/auth'
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
      showOrganizationList={showOrganizationList}
    />
  )
}
