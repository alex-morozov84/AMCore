'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { ConsoleStepUpDialog } from '@/shared/ui/console-step-up-dialog'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { RowActionsMenu } from '@/shared/ui/row-actions-menu'

import { useRevokeSession } from '../model/use-revoke-session'

interface SessionRowMenuProps {
  userId: string
  sessionId: string
  /** The already-formatted "Browser on OS" (or unknown-device) label, for the row's accessible name and confirm copy. */
  deviceLabel: string
  targetEmail: string
}

/**
 * Per-row revoke action, one hook instance per row (mirrors
 * `UserRoleAction`'s pattern) so each row's confirm/step-up state is
 * independent. Row-specific accessible names throughout — never a bare
 * "Actions"/"Revoke" shared across every row.
 */
export function SessionRowMenu({
  userId,
  sessionId,
  deviceLabel,
  targetEmail,
}: SessionRowMenuProps) {
  const t = useTranslations('console')
  const tCommon = useTranslations('common')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { confirm, isSubmitting, stepUp, isSteppingUp, submitStepUp, closeStepUp } =
    useRevokeSession(userId, sessionId)

  return (
    <>
      <RowActionsMenu label={t('userSessionsActionsFor', { device: deviceLabel })}>
        <DropdownMenuItem
          variant="destructive"
          disabled={isSubmitting}
          onClick={() => setConfirmOpen(true)}
        >
          {t('userSessionsRevokeOne')}
        </DropdownMenuItem>
      </RowActionsMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('userSessionsRevokeOneConfirmTitle')}
        description={t('userSessionsRevokeOneConfirmDescription', {
          device: deviceLabel,
          email: targetEmail,
        })}
        confirmLabel={t('userSessionsRevokeOne')}
        cancelLabel={tCommon('cancel')}
        variant="destructive"
        disabled={isSubmitting}
        onConfirm={() => void confirm()}
      />
      <ConsoleStepUpDialog
        phase={stepUp}
        isSubmitting={isSteppingUp}
        onSubmit={submitStepUp}
        onClose={closeStepUp}
      />
    </>
  )
}
