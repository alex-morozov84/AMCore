'use client'

import { useTranslations } from 'next-intl'

import { getErrorStatus } from '@/shared/api/errors'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'

import type { SetupFlow } from './bound-setup'
import { SetupAccountForm } from './setup-account-form'

export function SetupAdministrator({ flow, throttled }: { flow: SetupFlow; throttled: boolean }) {
  const t = useTranslations('console.organizationSetup')
  const { record, account } = flow
  const selected = account.isSuccess ? account.data : undefined
  const unavailable = account.isError && getErrorStatus(account.error) === 404
  if (!record) return null
  return (
    <div className="space-y-4">
      <ApiErrorAlert error={unavailable ? undefined : account.error} />
      {!record.selected ? (
        <SetupAccountForm
          email={record.draft.email}
          disabled={!flow.editable || throttled}
          onEmail={(email) => flow.setDraft({ ...record.draft, email })}
          onSubmit={(input) => flow.submit({ kind: 'prepare', input })}
        />
      ) : unavailable ? (
        <>
          <p role="alert">{t('recipientUnavailable')}</p>
          <Button
            variant="outline"
            disabled={!flow.editable || throttled || account.isFetching}
            onClick={flow.changeRecipient}
          >
            {t('changeRecipient')}
          </Button>
        </>
      ) : selected ? (
        <>
          <p className="break-words font-medium">{t('selected', { email: selected.email })}</p>
          <p role="status">{t(selected.emailVerified ? 'verified' : 'unverified')}</p>
          {!selected.emailVerified && (
            <>
              <p>{t('mailHelp')}</p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>{t('mailSteps.request')}</li>
                <li>{t('mailSteps.password')}</li>
                <li>{t('mailSteps.refresh')}</li>
              </ol>
              <details className="text-sm">
                <summary className="cursor-pointer">{t('mailTroubleTitle')}</summary>
                <p className="mt-2">{t('mailTrouble')}</p>
              </details>
              <Button
                disabled={!flow.editable || throttled || account.isFetching}
                onClick={() => void flow.refresh()}
              >
                {t('checkEmail')}
              </Button>
            </>
          )}
          {record.previousRecipientId && record.previousRecipientId !== selected.userId && (
            <p role="status">{t('identityChanged')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {selected.emailVerified && (
              <Button disabled={!flow.editable} onClick={() => flow.goTo('organization')}>
                {t('continue')}
              </Button>
            )}
            <Button variant="outline" disabled={!flow.editable} onClick={flow.changeRecipient}>
              {t('changeRecipient')}
            </Button>
          </div>
        </>
      ) : (
        <p role="status">{t('loading')}</p>
      )}
    </div>
  )
}
