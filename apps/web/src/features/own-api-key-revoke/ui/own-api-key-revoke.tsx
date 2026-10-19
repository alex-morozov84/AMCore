'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { type OwnApiKeyController, useRevokeOwnApiKey } from '@/entities/api-key'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

export function OwnApiKeyRevoke({
  controller,
  id,
  name,
  disabled,
  onRevoked,
}: {
  controller: OwnApiKeyController
  id: string
  name: string
  disabled: boolean
  onRevoked: () => void
}) {
  const t = useTranslations('ownApiKeys')
  const revoke = useRevokeOwnApiKey(controller)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      if (await revoke(id, { name })) onRevoked()
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="outline" disabled={disabled || busy} onClick={() => setOpen(true)}>
        {t('revoke')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('revokeTitle')}
        description={t('revokeDescription', { name })}
        confirmLabel={t('revoke')}
        cancelLabel={t('cancel')}
        variant="destructive"
        onConfirm={() => {
          void submit()
        }}
      />
      {error !== undefined && <ApiErrorAlert error={error} />}
    </>
  )
}
