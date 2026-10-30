import { productAdminPath } from '@amcore/shared'

import { SignInAgainMount } from '@/_app/account-security'

export default async function SignInAgain({
  searchParams,
}: {
  searchParams: Promise<{ entryId?: string | string[]; returnEntryId?: string | string[] }>
}) {
  return (
    <SignInAgainMount
      query={await searchParams}
      placement={{
        apiBase: '/product-admin/auth',
        mfaHref: productAdminPath('/mfa'),
        destination: productAdminPath('/organizations'),
      }}
    />
  )
}
