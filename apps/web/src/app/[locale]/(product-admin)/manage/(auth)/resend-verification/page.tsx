import { productAdminPath } from '@amcore/shared'

import { ResendVerificationPage } from '@/_pages/auth'

export default function Page() {
  return (
    <ResendVerificationPage
      actionBase="/product-admin/auth"
      loginHref={productAdminPath('/login')}
    />
  )
}
