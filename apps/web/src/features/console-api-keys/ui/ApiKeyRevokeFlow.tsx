'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { AdminApiKey } from '@amcore/shared'

import { consoleApi } from '@/shared/api/console-api'
import { ApiRequestError } from '@/shared/api/http-client'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'
import { toast } from '@/shared/ui/toast'

/** Props are the captured confirmation snapshot, never the current result page. */
export function ApiKeyRevokeFlow({
  targets,
  onBusy,
  onSuccess,
  onClose,
}: {
  targets: AdminApiKey[]
  onBusy: (busy: boolean) => void
  onSuccess: () => void
  onClose: () => void
}) {
  const t = useTranslations('console.apiKeys')
  const common = useTranslations('common')
  const router = useRouteProgressRouter()
  const [open, setOpen] = useState(true)
  const confirmed = useRef(false)
  const mutation = useStepUpMutation({
    mutationFn: () =>
      targets.length === 1
        ? consoleApi.revokeApiKey(targets[0]!.id)
        : consoleApi.revokeSelectedApiKeys(targets.map((key) => key.id)),
    onError: (error) => {
      const missing = error instanceof ApiRequestError && error.status === 404
      if (missing) {
        toast.add({ type: 'error', title: t('missing') })
        onSuccess()
        router.refresh()
      } else onClose()
      return missing
    },
    onSuccess: (result) => {
      toast.add({
        type: 'success',
        title: t('result', { count: result.affectedCount, requested: result.requestedCount }),
      })
      onSuccess()
      router.refresh()
    },
  })
  const busy =
    open || mutation.isSubmitting || mutation.isSteppingUp || mutation.stepUp.kind !== 'closed'
  useEffect(() => onBusy(busy), [busy, onBusy])
  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value)
            queueMicrotask(() => {
              if (!confirmed.current) onClose()
            })
        }}
        title={t('confirmTitle', { count: targets.length })}
        description={
          <span className="block space-y-2">
            <span className="block">{t('confirmDescription')}</span>
            <span className="block max-h-48 overflow-y-auto text-foreground">
              {targets.map((key) => (
                <span key={key.id} className="block break-all">
                  {key.name} · {key.owner.email} · {key.organization.name}
                </span>
              ))}
            </span>
          </span>
        }
        confirmLabel={t('revoke')}
        cancelLabel={common('cancel')}
        variant="destructive"
        disabled={mutation.isSubmitting}
        onConfirm={() => {
          confirmed.current = true
          void mutation.confirm()
        }}
      />
      <ConsoleStepUpDialog
        phase={mutation.stepUp}
        isSubmitting={mutation.isSteppingUp}
        onSubmit={mutation.submitStepUp}
        onClose={() => {
          mutation.closeStepUp()
          onClose()
        }}
      />
    </>
  )
}
