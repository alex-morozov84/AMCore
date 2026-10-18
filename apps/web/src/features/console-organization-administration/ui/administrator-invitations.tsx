import { useTranslations } from 'next-intl'
import type { AdministratorSummary } from '@amcore/shared'

import { Button } from '@/shared/ui/button'
import { PaginationButtons } from '@/shared/ui/pagination'

import type { AdministratorDialogAction } from './administrator-dialog'

export function AdministratorInvitations({
  data,
  blocked,
  page,
  onPageChange,
  onAction,
  isFetching,
}: {
  data: AdministratorSummary
  blocked: boolean
  page: number
  onPageChange: (page: number) => void
  onAction: (action: AdministratorDialogAction) => void
  isFetching: boolean
}) {
  const t = useTranslations('console.organizationAdministration')
  const mail = useTranslations('console.organizationProvisioning.mail')
  if (!data.invitations.total && page === 1) return null
  return (
    <section className="space-y-4 border-t pt-4">
      <h3 className="font-semibold">{t('invitationsTitle')}</h3>
      {!data.invitations.total && (
        <p className="text-sm text-muted-foreground">{t('noInvitations')}</p>
      )}
      {!data.invitations.data.length && page > 1 && (
        <Button variant="outline" onClick={() => onPageChange(1)}>
          {t('firstPage')}
        </Button>
      )}
      <ul className="space-y-4">
        {data.invitations.data.map((row) => (
          <li key={row.id} className="space-y-3 rounded-lg border p-4">
            <p className="break-all font-medium">{row.invite?.email ?? t('recipientRequired')}</p>
            <p>
              {t(
                row.invite?.status === 'pending'
                  ? 'refreshPending'
                  : row.invite?.status === 'expired'
                    ? 'refreshExpired'
                    : 'refreshMissing'
              )}
            </p>
            {row.mailOutcome && (
              <p className="text-sm text-muted-foreground">{mail(row.mailOutcome)}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {row.invite && (
                <Button
                  variant="outline"
                  disabled={
                    blocked || !data.policy.createAllowed || row.invite.status === 'unavailable'
                  }
                  onClick={() => onAction({ kind: 'reissue', row })}
                >
                  {t('reissue')}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={blocked || !data.policy.createAllowed}
                onClick={() => onAction({ kind: 'replace-recipient', row })}
              >
                {t('replace')}
              </Button>
              <Button
                variant="destructive"
                disabled={blocked}
                onClick={() => onAction({ kind: 'cancel', row })}
              >
                {t('cancel')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <PaginationButtons
        page={page}
        onPageChange={onPageChange}
        total={data.invitations.total}
        pageSize={20}
        previousLabel={t('previous')}
        nextLabel={t('next')}
        isFetching={isFetching}
      />
    </section>
  )
}
