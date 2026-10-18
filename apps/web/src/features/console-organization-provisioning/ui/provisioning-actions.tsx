'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  coerceSupportedLocale,
  createInvitationOperationId,
  type ProvisioningProgress,
} from '@amcore/shared'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

import { type Administrator, ProvisioningAdministratorForm } from './administrator-form'
import type { ProvisioningFlow } from './provisioning-wizard'

export function ProvisioningActions({
  flow,
  status,
  blocked,
}: {
  flow: ProvisioningFlow
  status: ProvisioningProgress
  blocked: boolean
}) {
  const t = useTranslations('console.organizationProvisioning')
  const locale = useLocale()
  const [mode, setMode] = useState<'replace' | 'reissue' | 'cancel' | null>(null)
  const [replacement, setReplacement] = useState<Administrator>()
  const [review, setReview] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Adjust this component's view after the frozen attempt settles; keep its draft mounted.
  if (submitted && !flow.busy && !flow.frozen) {
    setSubmitted(false)
    if (flow.error) setReview(false)
    else {
      setMode(null)
      setReplacement(undefined)
      setReview(false)
    }
  }
  const close = () => {
    setMode(null)
    setReplacement(undefined)
    setReview(false)
    flow.clearError()
  }
  const confirm = () => {
    setSubmitted(true)
    const base = { operationId: createInvitationOperationId(), expectedRevision: status.revision }
    if (mode === 'replace' && replacement)
      void flow.submit({ kind: 'replace-recipient', input: { ...base, ...replacement } })
    else if (mode === 'reissue' && status.invite)
      void flow.submit({
        kind: 'reissue',
        input: {
          ...base,
          expectedInviteId: status.invite.id,
          expectedGeneration: status.invite.generation,
        },
      })
    else if (mode === 'cancel') void flow.submit({ kind: 'cancel', input: base })
  }
  return (
    <div className="space-y-4">
      <div className="space-y-5 border-t pt-5">
        {status.invite && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('reissueHelp')}</p>
            <Button
              className="h-auto min-h-8 whitespace-normal text-center"
              variant="outline"
              disabled={blocked || !status.policy.createAllowed || flow.busy}
              onClick={() => setMode('reissue')}
            >
              {t('reissue')}
            </Button>
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('replaceHelp')}</p>
          <Button
            className="h-auto min-h-8 whitespace-normal text-center"
            variant={status.invite ? 'outline' : 'default'}
            disabled={blocked || !status.policy.createAllowed || flow.busy}
            onClick={() => setMode('replace')}
          >
            {status.invite ? t('replace') : t('chooseRecipient')}
          </Button>
        </div>
      </div>
      {mode === 'replace' && !review && !flow.frozen && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !flow.busy) {
              if (mode === 'replace' && review) setReview(false)
              else close()
            }
          }}
        >
          <DialogContent closeLabel={t('cancelForm')}>
            <DialogHeader>
              <DialogTitle>{t('replace')}</DialogTitle>
              <DialogDescription>{t('replaceHelp')}</DialogDescription>
            </DialogHeader>
            <ApiErrorAlert error={flow.error} />
            <ProvisioningAdministratorForm
              initial={
                replacement ?? { firstAdminEmail: '', inviteLocale: coerceSupportedLocale(locale) }
              }
              onNext={(value) => {
                flow.clearError()
                setReplacement(value)
                setReview(true)
              }}
              onBack={close}
            />
          </DialogContent>
        </Dialog>
      )}
      <div className="space-y-2 border-t pt-5">
        <h3 className="font-medium">{t('stopTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('stopHelp')}</p>
        <Button
          className="h-auto min-h-8 whitespace-normal text-center"
          variant="destructive"
          disabled={blocked || flow.busy}
          onClick={() => setMode('cancel')}
        >
          {t('endWithoutAdmin')}
        </Button>
      </div>
      <AlertDialog
        open={!!mode && (mode !== 'replace' || review) && !flow.frozen}
        onOpenChange={(open) => {
          if (!open && !flow.busy) {
            if (mode === 'replace' && review) setReview(false)
            else close()
          }
        }}
      >
        <AlertDialogContent className="[&>*]:min-w-0">
          <AlertDialogHeader className="min-w-0">
            <AlertDialogTitle>
              {mode === 'cancel'
                ? t('endWithoutAdmin')
                : mode === 'replace'
                  ? t('replace')
                  : t('reissue')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === 'cancel'
                ? t('cancelWarning')
                : mode === 'reissue'
                  ? t('reissueWarning')
                  : t('replaceWarning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(replacement || mode === 'reissue') && (
            <p className="break-all">{replacement?.firstAdminEmail ?? status.invite?.email}</p>
          )}
          <AlertDialogFooter className="sm:flex-col-reverse">
            <AlertDialogCancel
              className="h-auto min-h-8 w-full whitespace-normal"
              disabled={flow.busy}
              onClick={() => {
                if (mode === 'replace') setReview(false)
                else close()
              }}
            >
              {mode === 'cancel' ? t('backToInvitation') : t('back')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-auto min-h-8 w-full whitespace-normal"
              variant={mode === 'cancel' ? 'destructive' : 'default'}
              disabled={blocked || flow.busy || flow.frozen}
              onClick={confirm}
            >
              {mode === 'cancel'
                ? t('confirmCancel')
                : mode === 'replace'
                  ? t('confirmReplace')
                  : t('confirmReissue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
