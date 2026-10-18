'use client'

import { type ReactNode, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  type AdministratorInvitationProgress,
  type AdministratorSummary,
  createInvitationOperationId,
} from '@amcore/shared'

import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

import type { AdministratorPending } from '../model/command-journal'

import {
  type AdministratorFormValue,
  AdministratorInviteForm,
  AdministratorReasonForm,
} from './administrator-invite-form'

export type AdministratorDialogAction =
  | { kind: 'create' }
  | { kind: 'assign'; userId: string; memberId: string; email: string; roles: string[] }
  | { kind: 'reissue' | 'replace-recipient' | 'cancel'; row: AdministratorInvitationProgress }

export function AdministratorDialog({
  action,
  summary,
  onSubmit,
  onClose,
  blocked,
  frozen = false,
  error,
  children,
  onReview,
}: {
  action: AdministratorDialogAction
  summary: AdministratorSummary
  onSubmit: (pending: AdministratorPending) => void
  onClose: () => void
  blocked: boolean
  frozen?: boolean
  error?: unknown
  children?: ReactNode
  onReview?: () => void
}) {
  const [snapshot] = useState(summary)
  const t = useTranslations('console.organizationAdministration')
  const [draft, setDraft] = useState<AdministratorFormValue>()
  const [reason, setReason] = useState<string>()
  const title =
    action.kind === 'create'
      ? 'invite'
      : action.kind === 'assign'
        ? 'promote'
        : action.kind === 'replace-recipient'
          ? 'replace'
          : action.kind
  const needsEmail = action.kind === 'create' || action.kind === 'replace-recipient'
  const [review, setReview] = useState(false)

  const help =
    action.kind === 'assign'
      ? t('promoteHelp', { email: action.email, organization: snapshot.name })
      : action.kind === 'cancel'
        ? t('cancelHelp')
        : action.kind === 'reissue'
          ? t('reissueHelp')
          : action.kind === 'replace-recipient'
            ? t('replaceHelp')
            : t('reviewInvite', { organization: snapshot.name })
  function submit() {
    const base = { operationId: createInvitationOperationId(), reason: draft?.reason ?? reason! }
    let pending: AdministratorPending
    if (action.kind === 'create') pending = { kind: 'create', input: { ...base, ...draft! } }
    else if (action.kind === 'assign')
      pending = {
        kind: 'assign',
        input: {
          ...base,
          userId: action.userId,
          expectedMemberId: action.memberId,
          expectedAclVersion: snapshot.aclVersion,
        },
      }
    else if (action.kind === 'replace-recipient')
      pending = {
        kind: 'replace-recipient',
        id: action.row.id,
        input: { ...base, ...draft!, expectedRevision: action.row.revision },
      }
    else if (action.kind === 'reissue') {
      if (!action.row.invite) return
      pending = {
        kind: 'reissue',
        id: action.row.id,
        input: {
          ...base,
          expectedRevision: action.row.revision,
          expectedInviteId: action.row.invite.id,
          expectedGeneration: action.row.invite.generation,
        },
      }
    } else
      pending = {
        kind: 'cancel',
        id: action.row.id,
        input: { ...base, expectedRevision: action.row.revision },
      }
    onSubmit(pending)
  }
  return (
    <Dialog
      open={!frozen}
      onOpenChange={(open) => {
        if (!open && !frozen) onClose()
      }}
    >
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t(title)}</DialogTitle>
          <DialogDescription>{help}</DialogDescription>
        </DialogHeader>
        {action.kind === 'assign' && snapshot.initial?.state === 'awaiting' && (
          <p className="text-sm font-medium">{t('initialAssignmentWarning')}</p>
        )}
        {action.kind === 'assign' && (
          <p className="text-sm text-muted-foreground">
            {t('currentRoles', { roles: action.roles.join(', ') || t('noRoles') })}
          </p>
        )}
        <ApiErrorAlert error={error} />
        {children}
        {!review || error ? (
          needsEmail ? (
            <AdministratorInviteForm
              initial={draft}
              onNext={(value) => {
                onReview?.()
                setDraft(value)
                setReview(true)
              }}
              onBack={onClose}
            />
          ) : (
            <AdministratorReasonForm
              initial={reason}
              onNext={(value) => {
                onReview?.()
                setReason(value)
                setReview(true)
              }}
              onBack={onClose}
            />
          )
        ) : (
          <div className="space-y-4">
            {draft && <p className="break-all font-medium">{draft.email}</p>}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={blocked}
                onClick={() => {
                  setReview(false)
                }}
              >
                {t('back')}
              </Button>
              <Button
                variant={action.kind === 'cancel' ? 'destructive' : 'default'}
                disabled={blocked}
                onClick={submit}
              >
                {t(
                  action.kind === 'cancel'
                    ? 'confirmCancel'
                    : action.kind === 'assign'
                      ? 'promote'
                      : action.kind === 'reissue'
                        ? 'confirmReissue'
                        : 'confirmInvite'
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
