import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'

import { AccountSecurityPage } from '@/_pages/account-security'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'
import { hasCanonicalConsoleHost } from '@/shared/lib/console-host-guard'
import { requireSuperAdmin } from '@/shared/lib/require-super-admin'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { ConsoleAccountSecurityClient } from './ui/client'

import 'server-only'

/** Pending authentication must not require the admitted Console shell. */
export async function ConsoleAccountSecurityMount({ pending = false }: { pending?: boolean }) {
  if (!(await hasCanonicalConsoleHost())) notFound()
  if (pending && ADMIN_CONSOLE_CONFIG.mode !== 'host') notFound()
  if (!pending && (await requireSuperAdmin()) === 'unavailable')
    return <PrimaryUnavailableFallback reason="upstream" />
  const messages = await getMessages()
  return (
    <AccountSecurityPage standalone>
      <NextIntlClientProvider messages={messages}>
        <ConsoleAccountSecurityClient />
      </NextIntlClientProvider>
    </AccountSecurityPage>
  )
}
