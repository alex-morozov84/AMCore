import { getTranslations } from 'next-intl/server'

import { SignInAgainMount } from '@/_app/account-security'
import { requireConsoleEnabled } from '@/shared/lib/console-host-guard'
import { getConsoleOverviewHref, getConsoleSignInAgainHref } from '@/shared/lib/console-public-href'

export default async function SignInAgain({
  searchParams,
}: {
  searchParams: Promise<{ entryId?: string | string[]; returnEntryId?: string | string[] }>
}) {
  requireConsoleEnabled()
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
