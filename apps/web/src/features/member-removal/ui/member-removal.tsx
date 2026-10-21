'use client'
import { type RefObject, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  type MemberRemovalTarget,
  type OrganizationAccessController,
  useMemberRemoval,
} from '@/entities/organization-context'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { toast } from '@/shared/ui/toast'

import { RemovalNotice } from './removal-notice'

export function MemberRemoval({
  controller,
  target,
  actorId,
  heading,
  onLock,
  open,
  onOpenChange,
  organizationsHref,
  onSelfRemoved,
}: {
  controller: OrganizationAccessController
  target: MemberRemovalTarget
  actorId: string
  organizationsHref?: string
  onSelfRemoved?: () => void
  heading: RefObject<HTMLHeadingElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  onLock: (locked: boolean) => void
}) {
  const t = useTranslations('memberRemoval')
  const removal = useMemberRemoval(
    controller,
    target,
    target.userId === actorId ? onSelfRemoved : undefined
  )
  const outcome = removal.outcome
  useEffect(() => {
    onLock(
      open ||
        removal.pending ||
        removal.checking ||
        (outcome?.status === 'unknown' && removal.inspection?.status !== 'different')
    )
  }, [onLock, open, removal.pending, removal.checking, outcome?.status, removal.inspection?.status])
  const identity = t('identity', {
    organization: target.organizationName ?? t('selectedOrganization'),
    name: target.name ?? target.email,
    email: target.email,
  })
  const confirm = async () => {
    const result = await removal.remove()
    if (!result || result.status === 'retired' || result.status === 'busy') return
    if (result.status === 'committed') {
      if (target.userId !== actorId) toast.add({ type: 'success', title: t('success') })
    }
    heading.current?.focus()
  }
  return (
    <>
      <RemovalNotice
        removal={removal}
        target={target}
        self={target.userId === actorId}
        organizationsHref={organizationsHref}
        onReview={() => onOpenChange(true)}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('title')}
        description={
          <span className="block space-y-2">
            <span className="block break-all">{identity}</span>
            <span className="block">{t('warning')}</span>
            {target.userId === actorId && (
              <span className="block font-medium">{t('selfWarning')}</span>
            )}
          </span>
        }
        confirmLabel={t('confirm')}
        cancelLabel={t('cancel')}
        variant="destructive"
        disabled={!removal.canRemove}
        scrollable
        finalFocus={heading}
        onConfirm={() => void confirm()}
      />
    </>
  )
}
