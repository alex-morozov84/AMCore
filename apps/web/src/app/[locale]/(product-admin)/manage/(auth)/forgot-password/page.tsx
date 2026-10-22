import { productAdminPath } from '@amcore/shared'

import { ForgotPasswordPage } from '@/_pages/auth'

export default function Page() {
  return (
    <ForgotPasswordPage actionBase="/product-admin/auth" loginHref={productAdminPath('/login')} />
  )
}
