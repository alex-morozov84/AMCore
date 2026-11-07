'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { useCurrentUser } from '@/entities/user'
import { queryOwner } from '@/shared/api/query-session'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

import { useRevokeOtherSessions } from '../model/use-revoke-other-sessions'

export function RevokeOtherSessionsButton() {
  const t = useTranslations('sessions')
  const tCommon = useTranslations('common')
  const [open, setOpen] = useState(false)
  const { mutate, isPending } = useRevokeOtherSessions()
  const { data } = useCurrentUser()
  const disabled = isPending || !queryOwner(data)

  return (
    <>
      <Button variant="destructive" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        {t('revokeOthers')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('revokeOthersConfirmTitle')}
        description={t('revokeOthersConfirmDescription')}
        confirmLabel={t('revokeOthers')}
        cancelLabel={tCommon('cancel')}
        variant="destructive"
        disabled={disabled}
        onConfirm={() => mutate()}
      />
    </>
  )
}
