import { getTranslations } from 'next-intl/server'

import { SignInAgainMount } from '@/_app/account-security'
import { getConsoleOverviewHref, getConsoleSignInAgainHref } from '@/shared/lib/console-public-href'

export default async function SignInAgain({
  searchParams,
}: {
  searchParams: Promise<{ entryId?: string | string[]; returnEntryId?: string | string[] }>
}) {
  const t = await getTranslations('console')
  return (
    <SignInAgainMount
      query={await searchParams}
      standalone
      placement={{
        apiBase: '/auth',
        mfaHref: '/mfa',
        destination: getConsoleOverviewHref(),
        entryKind: 'console',
        recovery: {
          href: getConsoleSignInAgainHref(),
          description: t('logoutReturnUnknown'),
          label: t('freshSignIn'),
        },
      }}
    />
  )
}
