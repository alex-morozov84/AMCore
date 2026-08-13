import { useTranslations } from 'next-intl'

import { RevokeOtherSessionsButton } from '@/features/sessions/revoke-other-sessions'

import { SessionsTable } from './SessionsTable'

export function SessionsPage() {
  const t = useTranslations('sessions')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <RevokeOtherSessionsButton />
      </div>
      <SessionsTable />
    </div>
  )
}
