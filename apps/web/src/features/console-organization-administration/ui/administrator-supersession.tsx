'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createInvitationOperationId } from '@amcore/shared'
import { z } from 'zod'

import { getErrorCode, isApiError } from '@/shared/api/errors'
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
import { Button } from '@/shared/ui/button'

import type { AdministratorPending } from '../model/command-journal'

const details = z.strictObject({
  supersedesInvite: z.strictObject({
    id: z.string().min(1).max(128),
    generation: z.number().int().positive(),
  }),
})
export function AdministratorSupersession({
  error,
  command,
  onSubmit,
  blocked,
}: {
  error: unknown
  command?: AdministratorPending
  onSubmit: (pending: AdministratorPending) => void
  blocked: boolean
}) {
  const t = useTranslations('console.organizationAdministration')
  const [open, setOpen] = useState(false)
  const parsed = isApiError(error) ? details.safeParse(error.body.details) : undefined
  if (
    command?.kind !== 'create' ||
    getErrorCode(error) !== 'ADMIN_INVITATION_ALREADY_PENDING' ||
    !parsed?.success
  )
    return null
  return (
    <div className="space-y-3">
      <p>{t('supersedeHelp')}</p>
      <Button variant="outline" disabled={blocked} onClick={() => setOpen(true)}>
        {t('supersede')}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('supersede')}</AlertDialogTitle>
            <AlertDialogDescription>{t('supersedeHelp')}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all">{command.input.email}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('back')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={blocked}
              onClick={() => {
                onSubmit({
                  kind: 'create',
                  input: {
                    ...command.input,
                    operationId: createInvitationOperationId(),
                    supersedesInvite: parsed.data.supersedesInvite,
                  },
                })
                setOpen(false)
              }}
            >
              {t('supersede')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
