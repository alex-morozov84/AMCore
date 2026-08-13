'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'

import { useRevokeOtherSessions } from '../model/use-revoke-other-sessions'

/**
 * Confirmed via `AlertDialog` — unlike a single-row revoke, this affects
 * every other device at once and can't be scoped to "undo just this one."
 *
 * `open` is controlled explicitly: unlike `AlertDialogCancel` (Base UI's
 * own `Close` primitive, closes itself), `AlertDialogAction` is a plain
 * `Button` — clicking it does not close the dialog on its own.
 */
export function RevokeOtherSessionsButton() {
  const t = useTranslations('sessions')
  const tCommon = useTranslations('common')
  const [open, setOpen] = useState(false)
  const { mutate, isPending } = useRevokeOtherSessions()

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={isPending} />}>
        {t('revokeOthers')}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('revokeOthersConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('revokeOthersConfirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false)
              mutate()
            }}
          >
            {t('revokeOthers')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
