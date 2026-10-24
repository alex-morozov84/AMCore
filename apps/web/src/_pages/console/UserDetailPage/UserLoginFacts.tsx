import { getTranslations } from 'next-intl/server'
import type { AdminUserDetailResponse } from '@amcore/shared'

import { DetailFact } from '@/shared/ui/console-detail/DetailChrome'

export async function UserLoginFacts({
  diagnostics,
}: {
  diagnostics: AdminUserDetailResponse['loginDiagnostics']
}) {
  const t = await getTranslations('console.detail.login')
  return (
    <>
      <DetailFact label={t('password')}>
        {t(diagnostics.hasPassword ? 'configured' : 'notConfigured')}
        {!diagnostics.hasPassword && (
          <p className="mt-1 text-xs font-normal text-muted-foreground">{t('passwordHelp')}</p>
        )}
      </DetailFact>
      <DetailFact label={t('linkedAccounts')}>
        {diagnostics.linkedProviders.length
          ? diagnostics.linkedProviders.map((provider) => t(`providers.${provider}`)).join(', ')
          : t('noLinkedAccounts')}
        <p className="mt-1 text-xs font-normal text-muted-foreground">{t('linkedAccountsHelp')}</p>
      </DetailFact>
    </>
  )
}
