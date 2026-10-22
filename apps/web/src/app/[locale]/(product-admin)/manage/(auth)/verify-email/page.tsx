import { productAdminPath } from '@amcore/shared'

import { InvitationVerificationMount } from '@/_app/invitation-flow/index.server'
import { VerifyEmailPage } from '@/_pages/auth'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; inviteReturn?: string | string[] }>
}) {
  const { token: value, inviteReturn } = await searchParams
  const token = typeof value === 'string' ? value : undefined
  return typeof inviteReturn === 'string' ? (
    <InvitationVerificationMount token={token} selectorId={inviteReturn} admin />
  ) : (
    <VerifyEmailPage
      token={token}
      actionBase="/product-admin/auth"
      loginHref={productAdminPath('/login')}
      homeHref={productAdminPath('/organizations')}
      resendHref={productAdminPath('/resend-verification')}
    />
  )
}
