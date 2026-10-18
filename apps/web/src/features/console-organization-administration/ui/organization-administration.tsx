'use client'

import { useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type { AdminOrganizationDetailResponse, ProductAccessBootstrap } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { administrationClient } from '@/shared/api/console/administration-client'
import { useRetryDeadline } from '@/shared/hooks/use-retry-deadline'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { PaginationButtons } from '@/shared/ui/pagination'

import type { AdministratorPending } from '../model/command-journal'
import { useAdministratorCommand } from '../model/use-administrator-command'

import { AdministrationSession } from './administration-session'
import { AdministratorCommandState } from './administrator-command-state'
import { AdministratorDialog, type AdministratorDialogAction } from './administrator-dialog'
import { AdministratorInvitations } from './administrator-invitations'
import { AdministratorMembers } from './administrator-members'
import { AdministratorSupersession } from './administrator-supersession'

type Members = AdminOrganizationDetailResponse['members']['data']
function BoundAdministration({
  admission,
  orgId,
  members,
}: {
  admission: ProductAccessBootstrap
  orgId: string
  members: Members
}) {
  const t = useTranslations('console.organizationAdministration')
  const format = useFormatter()
  const [adminPage, setAdminPage] = useState(1)
  const [invitationPage, setInvitationPage] = useState(1)
  const [lastSubmission, setLastSubmission] = useState<AdministratorPending>()
  const [action, setAction] = useState<AdministratorDialogAction>()
  const [feedback, setFeedback] = useState<
    'sent' | 'assigned' | 'cancelledResult' | 'actionConfirmed'
  >()
  const [checked, setChecked] = useState(false)
  const query = useQuery({
    queryKey: ['organization-administration', admission.binding, orgId, adminPage, invitationPage],
    retry: false,
    gcTime: 0,
    queryFn: ({ signal }) =>
      administrationClient.summary(admission.binding, orgId, adminPage, invitationPage, signal),
  })
  const flow = useAdministratorCommand(admission, orgId, (kind) => {
    setFeedback(
      kind === 'assign'
        ? 'assigned'
        : kind === 'cancel'
          ? 'cancelledResult'
          : kind
            ? 'sent'
            : 'actionConfirmed'
    )
    setAction(undefined)
  })
  const throttled = useRetryDeadline(flow.retryAt)
  const blocked =
    query.isFetching ||
    query.isError ||
    !query.data ||
    !flow.ready ||
    flow.busy ||
    !!flow.record ||
    flow.retired ||
    throttled ||
    !flow.storageAvailable
  function submit(pending: AdministratorPending) {
    setLastSubmission(pending)
    void flow.submit(pending)
  }
  const data = query.isError ? undefined : query.data
  if (flow.retired) return <p role="alert">{t('sessionChanged')}</p>
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('adminsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4" aria-busy={query.isFetching || flow.busy}>
          <p>{t('adminsHelp')}</p>
          <ApiErrorAlert error={query.error} />
          <AdministratorCommandState flow={flow} />
          {!action && (
            <AdministratorSupersession
              error={flow.error}
              command={lastSubmission}
              onSubmit={submit}
              blocked={blocked}
            />
          )}
          {feedback && <p role="status">{t(feedback)}</p>}
          {query.isPending && <p role="status">{t('loading')}</p>}
          {data && (
            <>
              {!data.administrators.total && (
                <Alert variant="warning">
                  <AlertDescription>{t('noAdmins')}</AlertDescription>
                </Alert>
              )}
              <ul className="space-y-2">
                {data.administrators.data.map((admin) => (
                  <li key={admin.memberId} className="rounded-lg border p-3">
                    <p className="break-words font-medium">{admin.name ?? admin.email}</p>
                    <p className="break-all text-sm text-muted-foreground">{admin.email}</p>
                  </li>
                ))}
              </ul>
              {!data.administrators.data.length && adminPage > 1 && (
                <Button variant="outline" onClick={() => setAdminPage(1)}>
                  {t('firstPage')}
                </Button>
              )}
              <PaginationButtons
                page={adminPage}
                onPageChange={setAdminPage}
                total={data.administrators.total}
                pageSize={20}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                isFetching={query.isFetching}
              />
              {data.initial?.state === 'awaiting' && (
                <p className="text-sm text-muted-foreground">{t('initialPending')}</p>
              )}
              <Button
                disabled={
                  blocked || !data.policy.createAllowed || data.initial?.state === 'awaiting'
                }
                onClick={() => {
                  flow.clearError()
                  setAction({ kind: 'create' })
                }}
              >
                {t('invite')}
              </Button>
              {!data.policy.createAllowed && <p role="alert">{t('emailBlocked')}</p>}
              <AdministratorMembers
                members={members}
                administrators={data.administrators.data}
                blocked={blocked}
                onAction={(next) => {
                  flow.clearError()
                  setAction(next)
                }}
              />
              <AdministratorInvitations
                data={data}
                blocked={blocked}
                page={invitationPage}
                onPageChange={setInvitationPage}
                isFetching={query.isFetching}
                onAction={(next) => {
                  flow.clearError()
                  setAction(next)
                }}
              />
            </>
          )}
          <Button
            variant="outline"
            disabled={query.isFetching || flow.busy}
            onClick={() => {
              setChecked(false)
              void query.refetch().then((result) => {
                if (result.isSuccess) setChecked(true)
              })
            }}
          >
            {t('refresh')}
          </Button>
          {checked && data && !query.isError && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('checkedAt', {
                time: format.dateTime(new Date(data.checkedAt), {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                }),
              })}
            </p>
          )}
        </CardContent>
      </Card>
      {action && data && (
        <AdministratorDialog
          key={JSON.stringify(action)}
          action={action}
          summary={data}
          blocked={blocked}
          frozen={!!flow.record}
          error={flow.error}
          onReview={flow.clearError}
          onClose={() => {
            setAction(undefined)
            flow.clearError()
          }}
          onSubmit={submit}
        >
          <AdministratorSupersession
            error={flow.error}
            command={lastSubmission}
            onSubmit={submit}
            blocked={blocked}
          />
        </AdministratorDialog>
      )}
    </div>
  )
}
export function OrganizationAdministration({
  orgId,
  members,
}: {
  orgId: string
  members: Members
}) {
  return (
    <AdministrationSession>
      {(admission) => (
        <BoundAdministration
          key={`${admission.binding}:${orgId}`}
          admission={admission}
          orgId={orgId}
          members={members}
        />
      )}
    </AdministrationSession>
  )
}
