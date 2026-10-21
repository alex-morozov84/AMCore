import type { ReactNode } from 'react'
import { productAdminPath } from '@amcore/shared'

import { OrganizationAccessFrame } from '@/_app/organization-access'
import { ProductAdminHeader, ProductAdminSiteLink } from '@/_app/product-admin'
import { productAdminOrigins } from '@/shared/lib/product-admin-config.server'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <OrganizationAccessFrame
      sessionsHref={productAdminPath('/settings/sessions')}
      headerEnd={<ProductAdminHeader />}
      sidebarFooter={<ProductAdminSiteLink siteOrigin={productAdminOrigins().site} />}
    >
      {children}
    </OrganizationAccessFrame>
  )
}
