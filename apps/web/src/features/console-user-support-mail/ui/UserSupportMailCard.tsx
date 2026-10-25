'use client'

import { useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { SUPPORT_MAIL_KINDS } from '@amcore/shared'

import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'
import { Skeleton } from '@/shared/ui/skeleton'

import { useSupportMail } from '../model/use-support-mail'

import { SupportMailDialog } from './SupportMailDialog'

interface Props {
  userId: string
  actorId: string
  targetEmail: string
}
export function UserSupportMailCard(props: Props) {
  const locale = useLocale()
  return <MailCard key={`${props.actorId}:${props.userId}:${locale}`} {...props} />
}

function MailCard({ userId, actorId, targetEmail }: Props) {
  const t = useTranslations('console.supportMail')
  const flow = useSupportMail(userId, actorId)
  const refresh = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const { status, phase } = flow
  const prepared = phase.preparation
  const stepUpOpen = flow.mutation.stepUp.kind !== 'closed'
  const hidden = flow.authorityLost
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <CardTitle as="h2" className="text-xl">
          {t('title')}
        </CardTitle>
        <Button
          ref={refresh}
          variant="outline"
          size="sm"
          disabled={status.isFetching}
          onClick={() => void flow.refresh()}
        >
          {t('refresh')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {status.isFetching && status.data && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('refreshing')}
          </p>
        )}
        {!hidden && (
          <p className="break-all text-sm text-muted-foreground">
            {t('recipient', { email: targetEmail })}
          </p>
        )}
        {(status.isError || hidden) && <ApiErrorAlert error={status.error} />}
        {hidden ? (
          <p role="alert">{t('accessLost')}</p>
        ) : status.isPending ? (
          <div role="status" aria-busy="true" aria-label={t('loading')} className="space-y-5">
            {SUPPORT_MAIL_KINDS.map((kind) => (
              <div key={kind} className="space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-9 w-full sm:w-72" />
              </div>
            ))}
          </div>
        ) : (
          status.data && (
            <div className="space-y-5">
              {status.data.actions.map((action) => (
                <section key={action.kind} className="space-y-2">
                  <h3 className="font-medium">{t(`${action.kind}.title`)}</h3>
                  <p className="text-sm text-muted-foreground">{t(`${action.kind}.help`)}</p>
                  <Button
                    variant="outline"
                    className="h-auto min-h-9 w-full whitespace-normal py-2 sm:w-auto"
                    disabled={
                      !action.available ||
                      phase.kind !== 'idle' ||
                      flow.mutation.isSubmitting ||
                      status.isFetching ||
                      status.isError
                    }
                    onClick={(event) => {
                      trigger.current = event.currentTarget
                      void flow.start(action.kind)
                    }}
                  >
                    {t(`${action.kind}.button`)}
                  </Button>
                  {action.unavailableReason && (
                    <p className="text-sm text-muted-foreground">
                      {t(`unavailable.${action.unavailableReason}`)}
                      {action.retryAfterSeconds > 0
                        ? ` (${t('seconds', { count: action.retryAfterSeconds })})`
                        : ''}
                    </p>
                  )}
                  {action.latest ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">{t('lastAttempt')}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                        <span className="font-medium">{t(`summary.${action.latest.outcome}`)}</span>
                        <span className="text-xs text-muted-foreground">
                          <ConsoleTimestamp value={action.latest.attemptedAt} variant="inline" />
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t('detailsLabel', { kind: t(`${action.kind}.title`) })}
                          onClick={(event) => {
                            trigger.current = event.currentTarget
                            flow.reopen(action.kind, action.latest!.attemptId)
                          }}
                        >
                          {t('details')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t(action.resultExpired ? 'resultExpired' : 'noResult')}
                    </p>
                  )}
                </section>
              ))}
            </div>
          )
        )}
      </CardContent>
      <ConfirmDialog
        open={phase.kind === 'confirm'}
        onOpenChange={(open) => {
          if (!open) flow.dismissConfirmation()
        }}
        title={prepared ? t(`${prepared.kind}.confirmTitle`) : ''}
        scrollable
        description={
          prepared ? (
            <span className="block break-words [overflow-wrap:anywhere]">
              {t(`${prepared.kind}.confirm`, {
                email: prepared.recipient,
                minutes: Math.ceil(prepared.linkLifetimeSeconds / 60),
                hours: Math.ceil(prepared.linkLifetimeSeconds / 3600),
              })}
              {status.data?.actions.find((action) => action.kind === prepared.kind)?.latest
                ?.outcome === 'unknown' && <span className="mt-2 block">{t('unknownRepeat')}</span>}
            </span>
          ) : (
            ''
          )
        }
        confirmLabel={t('send')}
        cancelLabel={t('cancel')}
        onConfirm={flow.confirm}
        finalFocus={() =>
          trigger.current?.isConnected && !trigger.current.disabled
            ? trigger.current
            : refresh.current
        }
      />
      <ConsoleStepUpDialog
        phase={flow.mutation.stepUp}
        isSubmitting={flow.mutation.isSteppingUp}
        onSubmit={flow.mutation.submitStepUp}
        onClose={flow.close}
      />
      {!stepUpOpen && (
        <SupportMailDialog
          finalFocus={() =>
            trigger.current?.isConnected && !trigger.current.disabled
              ? trigger.current
              : refresh.current
          }
          phase={phase}
          onClose={flow.close}
          onCheck={flow.check}
        />
      )}
    </Card>
  )
}
