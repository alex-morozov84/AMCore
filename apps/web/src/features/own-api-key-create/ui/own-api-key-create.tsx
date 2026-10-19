'use client'

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslations } from 'next-intl'
import type { ApiKeyListResponse } from '@amcore/shared'

import {
  type OwnApiKeyController,
  useOwnApiKeySecret,
  useOwnKeyRevocation,
} from '@/entities/api-key'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { CopyButton } from '@/shared/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Timestamp } from '@/shared/ui/timestamp'
import { toast } from '@/shared/ui/toast'

import { useOwnKeyForm } from '../model/use-own-key-form'

import { OwnKeyFields } from './own-key-fields'

export function OwnApiKeyCreate({
  controller,
  organizationId,
  organizationName,
  canCreate,
  onInspect,
  onSaved,
  inspectionFocusRef,
  organizationControl,
  authorityStatus,
  authorityError,
  verifyTarget,
}: {
  controller: OwnApiKeyController
  organizationId?: string
  organizationName?: string
  canCreate: boolean
  inspectionFocusRef?: RefObject<HTMLElement | null>
  onSaved?: (key: { name: string; organizationId: string }) => void
  organizationControl?: ReactNode
  authorityStatus?: string
  authorityError?: unknown
  verifyTarget?: () => Promise<boolean>
  onInspect: (inspection?: ApiKeyListResponse) => Promise<unknown>
}) {
  const t = useTranslations('ownApiKeys')
  useEffect(() => () => controller.closeDraft(), [controller])
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const attempt = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  const session = useSyncExternalStore(
    controller.session.subscribe,
    controller.session.getSnapshot,
    controller.session.getSnapshot
  )
  const verificationFailed = useSyncExternalStore(
    controller.session.subscribe,
    controller.session.getFailureSnapshot,
    () => false
  )
  const draft = useOwnKeyForm(controller, organizationId ?? '', organizationName)
  const [open, setOpen] = useState(false)
  const [lose, setLose] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [inspectionError, setInspectionError] = useState<unknown>()
  const [checking, setChecking] = useState(false)
  const [inspectionOpen, setInspectionOpen] = useState(false)
  const [targetError, setTargetError] = useState(false)
  const [lostRevoke, setLostRevoke] = useState(false)
  const notified = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (attempt.phase === 'confirmed' && notified.current !== attempt.localId) {
      notified.current = attempt.localId
      toast.add({ type: 'success', title: t('createdTitle') })
    }
  }, [attempt.phase, attempt.localId, t])
  const pending = attempt.phase === 'pending'
  const confirmed = attempt.phase === 'confirmed'
  const unknown = attempt.phase === 'unknown'
  const secret = useOwnApiKeySecret(controller, organizationId)
  const revocation = useOwnKeyRevocation(controller)
  const close = (next: boolean) => {
    if (!next && pending) return
    if (!next && confirmed) {
      setLose(true)
      return
    }
    if (!next) {
      controller.closeDraft()
      draft.reset()
    }
    setOpen(next)
  }
  const inspect = async () => {
    setChecking(true)
    setInspectionError(undefined)
    try {
      const inspection = await controller.inspect()
      await onInspect(inspection)
      setInspectionOpen(true)
      setOpen(false)
    } catch (error) {
      setInspectionError(error)
    } finally {
      setChecking(false)
    }
  }
  return (
    <>
      <Button
        disabled={session === 'retired'}
        onClick={() => {
          if (attempt.phase === 'idle') {
            setCopyFailed(false)
            setInspectionError(undefined)
            setAcknowledged(false)
          }
          setOpen(true)
        }}
      >
        {t(attempt.phase === 'idle' ? 'create' : 'openResult')}
      </Button>
      {unknown && inspectionOpen && !open && (
        <div role="status" className="space-y-2">
          <p>{t('unknown')}</p>
        </div>
      )}
      <Dialog open={open && session !== 'retired'} onOpenChange={close}>
        <DialogContent
          finalFocus={inspectionOpen ? inspectionFocusRef : undefined}
          closeLabel={t('close')}
          className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-xl"
        >
          <DialogHeader>
            <DialogTitle>{t(confirmed ? 'createdTitle' : 'create')}</DialogTitle>
            <DialogDescription>{t('oneTime')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto [scrollbar-gutter:stable]">
            <p>{t('owner')}</p>
            {(attempt.phase === 'idle' || attempt.phase === 'preflight') && organizationControl}
            {attempt.input && <p>{t('keyName', { name: attempt.input.name })}</p>}
            <p>
              {t('organization', {
                name:
                  authorityStatus === 'denied'
                    ? t('organizationUnavailable')
                    : (attempt.organizationName ??
                      organizationName ??
                      t('organizationUnavailable')),
              })}
            </p>
            {attempt.input && (confirmed ? attempt.expiresAt : attempt.input.expiresAt) && (
              <div>
                <p className="text-sm text-muted-foreground">{t('expires')}</p>
                <Timestamp
                  value={(confirmed ? attempt.expiresAt : attempt.input.expiresAt)!}
                  timeZone={timeZone}
                />
              </div>
            )}
            {attempt.input && !(confirmed ? attempt.expiresAt : attempt.input.expiresAt) && (
              <p>{t('noExpiry')}</p>
            )}
            {pending && (
              <p role="status" aria-busy="true">
                {t('pending')}
              </p>
            )}
            {confirmed && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={secret ?? t('secretMask')}
                    aria-label={t('secret')}
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 font-mono"
                  />
                  <CopyButton
                    key={attempt.localId}
                    disabled={!secret}
                    label={t('copy')}
                    copied={t('copied')}
                    failed={t('copyUnavailable')}
                    onCopy={async () => {
                      const result = await controller.copyDetailed()
                      if (controller.getSnapshot().localId !== attempt.localId) return false
                      setCopyFailed(result === 'clipboardFailed')
                      return result === 'copied'
                    }}
                  />
                </div>
                {verificationFailed && (
                  <div role="status">
                    <p>{t('sessionCheckFailed')}</p>
                    <Button variant="outline" onClick={() => void controller.session.freshCheck()}>
                      {t('verify')}
                    </Button>
                  </div>
                )}
                {copyFailed && secret && <p role="status">{t('manualCopy')}</p>}
                <Button
                  onClick={() => {
                    if (attempt.input)
                      onSaved?.({
                        name: attempt.input.name,
                        organizationId: attempt.input.organizationId,
                      })
                    controller.acknowledgeSaved()
                    draft.reset()
                    setOpen(false)
                    void onInspect()
                  }}
                >
                  {t('saved')}
                </Button>
              </div>
            )}
            {unknown && (
              <div className="space-y-3">
                <p role="alert">{t('unknown')}</p>
                <Button
                  variant="outline"
                  disabled={checking}
                  onClick={() => {
                    void inspect()
                  }}
                >
                  {t('checkList')}
                </Button>
                {inspectionError !== undefined && <ApiErrorAlert error={inspectionError} />}
                {attempt.inspectionCompleted && (
                  <>
                    <p>{t('inspectionOnly')}</p>
                    <label className="flex items-start gap-2">
                      <Checkbox
                        checked={acknowledged}
                        onCheckedChange={(value) => setAcknowledged(value === true)}
                      />
                      <span>{t('unknownAck')}</span>
                    </label>
                    <Button
                      disabled={!acknowledged}
                      onClick={() => {
                        controller.dismissUnknown(acknowledged)
                        draft.reset()
                        setAcknowledged(false)
                      }}
                    >
                      {t('dismissUnknown')}
                    </Button>
                  </>
                )}
              </div>
            )}
            {attempt.phase === 'createdSecretLost' && (
              <>
                <p role="alert">{t('secretLost')}</p>
                {attempt.keyId && (
                  <Button variant="outline" onClick={() => setLostRevoke(true)}>
                    {t('revoke')}
                  </Button>
                )}
                {revocation.phase === 'pending' && <p role="status">{t('revokePending')}</p>}
                {revocation.phase === 'unknown' && <p role="alert">{t('revokeUnknown')}</p>}
                {inspectionError !== undefined && <ApiErrorAlert error={inspectionError} />}
                <Button
                  onClick={() => {
                    controller.acknowledgeSaved()
                    draft.reset()
                    setOpen(false)
                  }}
                >
                  {t('close')}
                </Button>
              </>
            )}
            {attempt.phase === 'idle' || attempt.phase === 'preflight' ? (
              <form
                className="space-y-4"
                onSubmit={async (event) => {
                  event.preventDefault()
                  if (!organizationId) {
                    setTargetError(true)
                    return
                  }
                  if (!verifyTarget && !canCreate) {
                    setTargetError(true)
                    return
                  }
                  setTargetError(false)
                  await draft.submit(event, verifyTarget)
                }}
              >
                <OwnKeyFields draft={draft} disabled={attempt.phase === 'preflight'} />
                {targetError && <p role="alert">{t('creationCheckFailed')}</p>}
                {authorityError !== undefined && authorityError !== null && (
                  <ApiErrorAlert error={authorityError} />
                )}
                {organizationId && authorityStatus === 'ready' && !canCreate && (
                  <p role="status">{t('creationDenied')}</p>
                )}
                {attempt.error?.message === 'OWN_KEY_AUTHORITY_UNAVAILABLE' ? (
                  <p role="alert">{t('creationCheckFailed')}</p>
                ) : attempt.error ? (
                  <ApiErrorAlert error={attempt.error} />
                ) : null}
                <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 bg-card py-2">
                  <Button type="button" variant="outline" onClick={() => close(false)}>
                    {t('cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      !organizationId ||
                      !draft.valid ||
                      attempt.phase === 'preflight' ||
                      (authorityStatus === 'ready' && !canCreate)
                    }
                  >
                    {t('create')}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={lostRevoke}
        onOpenChange={setLostRevoke}
        title={t('revokeTitle')}
        description={t('revokeDescription', { name: attempt.input?.name ?? '' })}
        confirmLabel={t('revoke')}
        cancelLabel={t('cancel')}
        variant="destructive"
        onConfirm={() => {
          if (attempt.keyId)
            void controller
              .revoke(attempt.keyId, {
                name: attempt.input?.name,
                organizationName: attempt.organizationName,
              })
              .then((ok) => {
                if (ok) toast.add({ type: 'success', title: t('revokeSuccess') })
                return onInspect()
              })
              .catch((error: unknown) => setInspectionError(error))
        }}
      />
      <ConfirmDialog
        open={lose}
        onOpenChange={setLose}
        title={t('loseTitle')}
        description={t('loseDescription')}
        confirmLabel={t('loseConfirm')}
        cancelLabel={t('cancel')}
        variant="destructive"
        onConfirm={() => {
          controller.acknowledgeSaved()
          draft.reset()
          setOpen(false)
        }}
      />
    </>
  )
}
