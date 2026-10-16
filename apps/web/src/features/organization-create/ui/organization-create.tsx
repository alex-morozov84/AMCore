'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CreateOrganizationInput } from '@amcore/shared'

import type { useOrganizationCreation } from '@/entities/organization-context'
import { getErrorCode, getRetryAfterMs } from '@/shared/api/errors'
import { useRetryDeadline } from '@/shared/hooks/use-retry-deadline'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'

import { OrganizationCreateForm } from './organization-create-form'

export function OrganizationCreate({
  flow,
  onOpen,
}: {
  flow: ReturnType<typeof useOrganizationCreation>
  onOpen: (id: string) => void
}) {
  const t = useTranslations('organizationCreation')
  const { state, controller, policy } = flow
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CreateOrganizationInput>()
  const trigger = useRef<HTMLButtonElement>(null)
  const opened = useRef<string | undefined>(undefined)
  const busy = state.phase === 'pending' || state.phase === 'recovering'
  useEffect(() => {
    if (
      state.phase === 'succeeded' &&
      state.access === 'ready' &&
      state.result &&
      opened.current !== state.result.organizationId
    ) {
      opened.current = state.result.organizationId
      onOpen(state.result.organizationId)
    }
  }, [state, onOpen])
  const policyThrottled = useRetryDeadline(
    policy.error ? policy.errorUpdatedAt + (getRetryAfterMs(policy.error) ?? 0) : undefined
  )
  const throttled = useRetryDeadline(state.retryAt)
  const frozen = !!state.attempt
  const wasEditing = useRef(false)
  useEffect(() => {
    if (!editing && wasEditing.current) trigger.current?.focus()
    wasEditing.current = editing
  }, [editing])
  function cancel() {
    controller.dismiss()
    setEditing(false)
    setDraft(undefined)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!state.storageAvailable && (
          <Alert>
            <AlertDescription>{t('storageUnavailable')}</AlertDescription>
          </Alert>
        )}
        {state.phase === 'hydrating' || busy ? (
          <p role="status" aria-live="polite">
            {t(busy ? 'pending' : 'loading')}
          </p>
        ) : null}
        {state.phase === 'session-retired' ? (
          <p role="alert">{t('sessionChanged')}</p>
        ) : (
          <>
            {getErrorCode(state.error) === 'CONFLICT' ? (
              <Alert variant="destructive">
                <AlertDescription>{t('slugTaken')}</AlertDescription>
              </Alert>
            ) : (
              <ApiErrorAlert error={state.error} />
            )}
            {frozen ? (
              <div className="space-y-3">
                <p className="break-words font-medium">{state.attempt!.input.name}</p>
                {!busy && (
                  <p role="status" aria-live="polite">
                    {t(
                      state.phase === 'rejected'
                        ? 'changed'
                        : state.phase === 'succeeded'
                          ? state.access === 'changed'
                            ? 'accessChanged'
                            : state.access === 'unavailable'
                              ? 'accessUnavailable'
                              : 'created'
                          : 'unknown'
                    )}
                  </p>
                )}
                {!busy && (
                  <div className="flex flex-wrap gap-2">
                    {state.phase !== 'rejected' && (
                      <Button
                        variant="outline"
                        disabled={throttled}
                        onClick={() => {
                          void controller.check()
                        }}
                      >
                        {t('check')}
                      </Button>
                    )}
                    {state.phase === 'unknown' && (
                      <Button
                        variant="outline"
                        disabled={throttled || !policy.data?.selfServiceCreationEnabled}
                        onClick={() => {
                          void controller.repeat()
                        }}
                      >
                        {t('repeat')}
                      </Button>
                    )}
                    {(state.phase === 'rejected' || state.phase === 'succeeded') && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          controller.dismiss()
                          setEditing(false)
                        }}
                      >
                        {t('dismiss')}
                      </Button>
                    )}
                  </div>
                )}
                {throttled && <p role="status">{t('wait')}</p>}
              </div>
            ) : !busy && state.phase !== 'hydrating' ? (
              <>
                {policy.isPending ? (
                  <p>{t('loading')}</p>
                ) : policy.isError ? (
                  <div className="space-y-2">
                    <ApiErrorAlert error={policy.error} />
                    <Button
                      variant="outline"
                      disabled={policyThrottled}
                      onClick={() => {
                        void policy.refetch()
                      }}
                    >
                      {t('refreshPolicy')}
                    </Button>
                  </div>
                ) : policy.data?.selfServiceCreationEnabled ? (
                  <>
                    <Button
                      ref={trigger}
                      variant="outline"
                      className={editing ? 'hidden' : ''}
                      onClick={() => setEditing(true)}
                    >
                      {t('create')}
                    </Button>
                    {editing && (
                      <OrganizationCreateForm
                        initial={draft}
                        onCancel={cancel}
                        onSubmit={(input) => {
                          setDraft(input)
                          void controller.submit(input)
                        }}
                      />
                    )}
                  </>
                ) : (
                  <p>{t('disabled')}</p>
                )}
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
