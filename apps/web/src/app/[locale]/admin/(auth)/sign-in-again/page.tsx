import { SignInAgainMount } from '@/_app/account-security'
import { getConsoleOverviewHref } from '@/shared/lib/console-public-href'

export default async function SignInAgain({
  searchParams,
}: {
  searchParams: Promise<{ entryId?: string | string[]; returnEntryId?: string | string[] }>
}) {
  return (
    <SignInAgainMount
      query={await searchParams}
      standalone
      placement={{
        apiBase: '/auth',
        mfaHref: '/mfa',
        destination: getConsoleOverviewHref(),
        entryKind: 'console',
      }}
    />
  )
}
