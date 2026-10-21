import { productAdminPath } from '@amcore/shared'

import { ResetPasswordPage } from '@/_pages/auth'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams
  return (
    <ResetPasswordPage
      token={typeof token === 'string' ? token : undefined}
      actionBase="/product-admin/auth"
      loginHref={productAdminPath('/login')}
      forgotPasswordHref={productAdminPath('/forgot-password')}
    />
  )
}
