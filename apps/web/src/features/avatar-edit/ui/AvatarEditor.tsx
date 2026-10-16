'use client'

import { useRef } from 'react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { AVATAR_LIMITS, useAvatarEditor, UserAvatar } from '@/entities/user'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

/**
 * Ready avatar editing block: the current photo, a file picker, and a confirmed removal. It is
 * editable JSX over the headless `useAvatarEditor`; a different UI can use the same hook.
 */
export function AvatarEditor({ className }: { className?: string }) {
  const t = useTranslations('account.avatar')
  const editor = useAvatarEditor()
  const input = useRef<HTMLInputElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const name = editor.user?.name ?? editor.user?.email ?? null
  const outcome = editor.outcome
  const message = outcome ? messageKeyFor(outcome) : null

  return (
    <div className={className}>
      <div className="flex items-center gap-4">
        <UserAvatar name={name} avatarUrl={editor.avatarUrl} size="xl" />
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={editor.isPending}
              onClick={() => input.current?.click()}
            >
              {editor.avatarUrl ? t('change') : t('choose')}
            </Button>
            {editor.avatarUrl && (
              <Button
                type="button"
                variant="ghost"
                disabled={editor.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                {t('remove')}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('photoLabel')}
        accept={AVATAR_LIMITS.mimeTypes.join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void editor.upload(file)
        }}
      />
      <div role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">
        {editor.isPending && (editor.action === 'remove' ? t('removing') : t('uploading'))}
        {outcome?.kind === 'committed' &&
          (editor.action === 'remove' ? t('removed') : t('uploaded'))}
      </div>
      {message === 'other' ? (
        <ApiErrorAlert error={editor.error} className="mt-3" />
      ) : message ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{t(message)}</AlertDescription>
        </Alert>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('removeTitle')}
        description={t('removeDescription')}
        confirmLabel={t('removeConfirm')}
        cancelLabel={t('cancel')}
        variant="destructive"
        onConfirm={() => void editor.remove()}
      />
    </div>
  )
}

type MessageKey = 'tooLarge' | 'invalidType' | 'busy' | 'unknown' | 'other'

function messageKeyFor(outcome: NonNullable<ReturnType<typeof useAvatarEditor>['outcome']>) {
  switch (outcome.kind) {
    case 'rejected':
      return outcome.reason === 'too_large'
        ? 'tooLarge'
        : outcome.reason === 'invalid_type'
          ? 'invalidType'
          : ('other' as MessageKey)
    case 'busy':
      return 'busy' as MessageKey
    case 'unknown':
      return 'unknown' as MessageKey
    default:
      return null
  }
}
