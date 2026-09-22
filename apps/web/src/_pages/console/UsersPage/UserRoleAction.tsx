'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { type AdminUserResponse, SystemRole } from '@amcore/shared'

import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { RowActionsMenu } from '@/shared/ui/row-actions-menu'

import { RoleStepUpDialog } from './RoleStepUpDialog'
import { useUserRoleChange } from './use-user-role-change'

interface UserRoleActionProps {
  user: Pick<AdminUserResponse, 'id' | 'systemRole'>
  isSelf: boolean
}

/**
 * A promote/demote toggle — `SystemRole` is binary, never a role picker.
 * Self-row is absent entirely, not merely disabled: the server also refuses
 * a self-change, this only avoids offering a guaranteed-to-fail round trip.
 */
export function UserRoleAction({ user, isSelf }: UserRoleActionProps) {
  const t = useTranslations('console')
  const tCommon = useTranslations('common')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isPromote = user.systemRole !== SystemRole.SuperAdmin
  const targetRole = isPromote ? SystemRole.SuperAdmin : SystemRole.User
  const { confirmRoleChange, isSubmitting, stepUp, isSteppingUp, submitStepUp, closeStepUp } =
    useUserRoleChange(user.id, targetRole)

  if (isSelf) return null

  return (
    <>
      <RowActionsMenu label={t('usersColumnActions')}>
        <DropdownMenuItem
          variant={isPromote ? 'default' : 'destructive'}
          disabled={isSubmitting}
          onClick={() => setConfirmOpen(true)}
        >
          {t(isPromote ? 'usersActionPromote' : 'usersActionDemote')}
        </DropdownMenuItem>
      </RowActionsMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t(isPromote ? 'usersPromoteConfirmTitle' : 'usersDemoteConfirmTitle')}
        description={t(
          isPromote ? 'usersPromoteConfirmDescription' : 'usersDemoteConfirmDescription'
        )}
        confirmLabel={t(isPromote ? 'usersActionPromote' : 'usersActionDemote')}
        cancelLabel={tCommon('cancel')}
        variant={isPromote ? 'default' : 'destructive'}
        disabled={isSubmitting}
        onConfirm={() => void confirmRoleChange()}
      />
      <RoleStepUpDialog
        phase={stepUp}
        isSubmitting={isSteppingUp}
        onSubmit={submitStepUp}
        onClose={closeStepUp}
      />
    </>
  )
}
