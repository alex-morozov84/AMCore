'use client'

import type { ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  confirmLabel: ReactNode
  cancelLabel: ReactNode
  /** The confirm button's own style — `destructive` for an irreversible or
   * dangerous action, `default` for an ordinary confirmation. */
  variant?: 'default' | 'destructive'
  /** Fires once the operator confirms; the dialog is already closed by
   * then, so a slow or failing action is entirely this callback's own
   * concern (a toast, a follow-up dialog, whatever fits the caller). */
  onConfirm: () => void
  disabled?: boolean
}

/**
 * A confirm-before-you-act dialog: state the consequence, then either
 * cancel or commit. Deliberately closes itself the moment the operator
 * confirms rather than waiting on the action's own result — this keeps the
 * dialog itself free of any knowledge about what "confirm" actually does.
 *
 * Fully controlled, with no trigger of its own: a plain button
 * (`RevokeOtherSessionsButton`) and a dropdown menu item
 * (`UserRoleAction`) both need to open this from a different kind of
 * trigger, and a dialog nested inside a menu item fights that menu's own
 * close/focus handling — keeping this dialog and its trigger as siblings,
 * coupled only through `open`, avoids that entirely.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  disabled,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={variant}
            disabled={disabled}
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
