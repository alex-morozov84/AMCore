import { AuthFrame } from '@/_pages/auth'
import { productAdminOrigins } from '@/shared/lib/product-admin-config.server'

import { ProductAdminDenied } from '../ui/denied-page'

export function ProductAdminDeniedPage({
  showOrganizationList = true,
}: { showOrganizationList?: boolean } = {}) {
  return (
    <AuthFrame>
      <ProductAdminDenied
        siteOrigin={productAdminOrigins().site}
        showOrganizationList={showOrganizationList}
      />
    </AuthFrame>
  )
}

export function ProductAdminRecovery({
  showOrganizationList = true,
}: { showOrganizationList?: boolean } = {}) {
  return (
    <ProductAdminDenied
      siteOrigin={productAdminOrigins().site}
      showOrganizationList={showOrganizationList}
    />
  )
}
