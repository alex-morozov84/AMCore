'use client'
import { type RefObject, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  type MemberRemovalTarget,
  type OrganizationAccessController,
  useMemberRemoval,
} from '@/entities/organization-context'
import { getErrorCode, getErrorStatus } from '@/shared/api/errors'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { toast } from '@/shared/ui/toast'

export function MemberRemoval({
  controller,
  target,
  actorId,
  heading,
  onLock,
  open,
  onOpenChange,
  organizationsHref,
}: {
  controller: OrganizationAccessController
  target: MemberRemovalTarget
  actorId: string
  organizationsHref?: string
  heading: RefObject<HTMLHeadingElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  onLock: (locked: boolean) => void
}) {
  const t = useTranslations('memberRemoval')
  const removal = useMemberRemoval(controller, target)
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
    if (result?.status === 'committed') toast.add({ type: 'success', title: t('success') })
    heading.current?.focus()
  }
  const error = outcome && 'error' in outcome ? outcome.error : undefined
  const lastAdmin =
    getErrorStatus(error) === 400 && getErrorCode(error) === 'BUSINESS_RULE_VIOLATION'
  const limit = getErrorStatus(error) === 409 && getErrorCode(error) === 'MEMBER_API_KEYS_LIMIT'
  return (
    <>
      {(removal.pending || outcome || removal.inspection) && (
        <section className="space-y-2 rounded-lg border p-3" aria-live="polite">
          <p className="break-all font-medium">{identity}</p>
          {removal.pending && <p role="status">{t('pending')}</p>}
          {outcome?.status === 'committed' && (
            <>
              <p>{t('success')}</p>
              {outcome.followup !== 'ready' && <p>{t('refreshFailed')}</p>}
              {target.userId === actorId && organizationsHref && (
                <RouteProgressLink href={organizationsHref}>{t('organizations')}</RouteProgressLink>
              )}
            </>
          )}
          {outcome?.status === 'unknown' && <p>{t('unknown')}</p>}
          {outcome?.status === 'rejected' &&
            (lastAdmin ? (
              <p>{t('lastAdmin')}</p>
            ) : limit ? (
              <p>{t('limit')}</p>
            ) : (
              <ApiErrorAlert error={error} />
            ))}
          {removal.inspection && <p>{t(removal.inspection.status)}</p>}
          {removal.inspection?.status === 'error' && (
            <ApiErrorAlert error={removal.inspection.error} />
          )}
          {outcome && !removal.pending && (
            <Button
              variant="outline"
              disabled={removal.checking || removal.busy}
              onClick={() => void removal.inspect()}
            >
              {t('check')}
            </Button>
          )}
          {outcome && removal.inspection?.status === 'same' && removal.canRemove && (
            <Button variant="outline" onClick={() => onOpenChange(true)}>
              {t('review')}
            </Button>
          )}
        </section>
      )}
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
