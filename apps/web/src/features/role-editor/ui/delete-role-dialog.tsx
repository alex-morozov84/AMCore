'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { RoleDefinitionDetail } from '@amcore/shared'

import type { useRoleDefinition } from '@/entities/organization-context'
import { getErrorCode } from '@/shared/api/errors'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { toast } from '@/shared/ui/toast'

/** What a person confirms when deleting: the role, its revision and the people it affects. */
const impactKey = (detail: RoleDefinitionDetail) =>
  JSON.stringify([
    detail.role.id,
    detail.aclVersion,
    detail.holders.total,
    detail.impact.liveInvitationCount,
    detail.selfHeld,
  ])

/**
 * Deleting names the exact numbers the person saw and acknowledged. The dialog keeps that snapshot:
 * the command is sent for it, never for newer data. If the live role drifts while the dialog is
 * open (a new holder, an invitation that expired, a new revision) the acknowledgment is dropped and
 * confirming stays off until the person reviews the current numbers. An acknowledgment is asked
 * only when something is actually affected: people, pending invitations or the person deleting.
 */
export function DeleteRoleDialog({
  role,
  detail,
  disabled,
  onDeleted,
}: {
  role: ReturnType<typeof useRoleDefinition>
  detail: RoleDefinitionDetail
  disabled: boolean
  onDeleted: () => void
}) {
  const t = useTranslations('organizationRoles')
  const [open, setOpen] = useState(false)
  const [frozen, setFrozen] = useState<RoleDefinitionDetail>()
  const [understood, setUnderstood] = useState(false)
  const [failure, setFailure] = useState<{ error?: unknown; unknown?: boolean }>()
  const shown = frozen ?? detail
  const drifted = frozen !== undefined && impactKey(frozen) !== impactKey(detail)
  const holders = shown.holders.total
  const invitations = shown.impact.liveInvitationCount
  const needsAck = holders > 0 || invitations > 0 || shown.selfHeld
  const review = () => {
    setFrozen(detail)
    setUnderstood(false)
    setFailure(undefined)
  }
  const change = (next: boolean) => {
    setOpen(next)
    setUnderstood(false)
    setFailure(undefined)
    setFrozen(next ? detail : undefined)
  }
  const run = async () => {
    setFailure(undefined)
    const outcome = await role.remove({
      expectedAclVersion: shown.aclVersion,
      expectedLiveInvitationCount: invitations,
      ...(shown.selfHeld ? { acknowledgeSelfHeld: true as const } : {}),
    })
    if (outcome.status === 'committed') {
      toast.add({ type: 'success', title: t('deletedToast') })
      onDeleted()
    } else if (outcome.status === 'rejected') setFailure({ error: outcome.error })
    else if (outcome.status === 'unknown') setFailure({ unknown: true })
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button variant="destructive" disabled={disabled} />}>
        {t('delete')}
      </DialogTrigger>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>
            {holders === 0 && invitations === 0 ? t('deleteNone') : t('deleteIrreversible')}
          </DialogDescription>
        </DialogHeader>
        {(holders > 0 || invitations > 0) && (
          <Alert variant="warning">
            <AlertDescription className="font-medium text-card-foreground">
              {holders > 0 && <p>{t('deletePeople', { holders })}</p>}
              {invitations > 0 && <p>{t('deleteInvites', { invitations })}</p>}
            </AlertDescription>
          </Alert>
        )}
        {shown.selfHeld && <p role="status">{t('selfHeldBody')}</p>}
        {drifted && (
          <Alert variant="warning">
            <AlertDescription className="gap-3">
              <p className="font-medium text-card-foreground">{t('deleteImpactChanged')}</p>
              <Button type="button" variant="outline" size="sm" onClick={review}>
                {t('reviewCurrent')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {needsAck && !drifted && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} />
            {t('deleteAck')}
          </label>
        )}
        {failure?.error !== undefined && (
          <div role="status" className="space-y-1">
            <ApiErrorAlert error={failure.error} />
            {getErrorCode(failure.error) === 'ROLE_DELETE_IMPACT_CHANGED' && (
              <p>{t('deleteImpactChanged')}</p>
            )}
          </div>
        )}
        {failure?.unknown && <p role="status">{t('saveUnknown')}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={drifted || (needsAck && !understood) || role.busy}
            onClick={() => void run()}
          >
            {t('deleteConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
