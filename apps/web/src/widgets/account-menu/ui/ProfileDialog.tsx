'use client'

import { type ComponentProps, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import { useCurrentUser } from '@/entities/user'
import { AvatarEditor } from '@/features/avatar-edit'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus']
}

/**
 * Controlled profile dialog: read-only name and email plus the avatar editor. It has no trigger
 * of its own (the caller places the opener) and closes itself when the signed-in user changes.
 */
export function ProfileDialog({ open, onOpenChange, finalFocus }: ProfileDialogProps) {
  const t = useTranslations('account')
  const tCommon = useTranslations('common')
  const { data } = useCurrentUser()
  const user = data?.user ?? null
  const shownFor = useRef(user?.id)

  useEffect(() => {
    if (shownFor.current !== user?.id) {
      shownFor.current = user?.id
      onOpenChange(false)
    }
  }, [user?.id, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tCommon('close')} finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('profileTitle')}</DialogTitle>
          <DialogDescription>{t('profileDescription')}</DialogDescription>
        </DialogHeader>
        <AvatarEditor />
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t('nameLabel')}</dt>
            <dd className="break-words">{user?.name || t('noName')}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('emailLabel')}</dt>
            <dd className="break-all">{user?.email}</dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  )
}
