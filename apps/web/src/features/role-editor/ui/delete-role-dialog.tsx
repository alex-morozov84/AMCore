'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { RoleDefinitionDetail } from '@amcore/shared'

import type { useRoleDefinition } from '@/entities/organization-context'
import { getErrorCode } from '@/shared/api/errors'
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

/**
 * Deleting names the exact numbers it was loaded with and asks to confirm those; the server
 * rejects the command if either number changed, so a stale confirmation can never go through.
 * A persistent dialog (not a fire-and-forget confirm) keeps its result visible.
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
  const [understood, setUnderstood] = useState(false)
  const [failure, setFailure] = useState<{ error?: unknown; unknown?: boolean }>()
  const change = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setUnderstood(false)
      setFailure(undefined)
    }
  }
  const run = async () => {
    setFailure(undefined)
    const outcome = await role.remove({
      expectedAclVersion: detail.aclVersion,
      expectedLiveInvitationCount: detail.impact.liveInvitationCount,
      ...(detail.selfHeld ? { acknowledgeSelfHeld: true as const } : {}),
    })
    if (outcome.status === 'committed') onDeleted()
    else if (outcome.status === 'rejected') setFailure({ error: outcome.error })
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
            {t('deleteBody', {
              holders: detail.holders.total,
              invitations: detail.impact.liveInvitationCount,
            })}
          </DialogDescription>
        </DialogHeader>
        {detail.selfHeld && <p role="status">{t('selfHeldBody')}</p>}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} />
          {t('deleteAck')}
        </label>
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
            disabled={!understood || role.busy}
            onClick={() => void run()}
          >
            {t('deleteConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
