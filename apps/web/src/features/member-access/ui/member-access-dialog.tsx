'use client'
import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import {
  type OrganizationAccessController,
  useCapabilityCatalogue,
  useMemberAccess,
} from '@/entities/organization-context'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Skeleton } from '@/shared/ui/skeleton'

import { roleNamer, splitItems } from '../model/access-view'
import { useAccessLabels } from '../model/use-access-labels'

import { AccessInactive, AccessItems, AccessRoles } from './access-lists'
import { AccessNotes, OtherPermissions } from './access-notes'

/**
 * What one member can do in this organization and why, as the server works it out from the same
 * rules it uses to authorize. Read-only; a failed read hides the answer instead of showing stale
 * facts, and a background reread keeps what is already shown. The header and footer stay in place
 * while the body scrolls.
 */
export function MemberAccessDialog({
  controller,
  userId,
  onClose,
}: {
  controller: OrganizationAccessController
  userId: string
  onClose: () => void
}) {
  const t = useTranslations('memberAccess')
  const heading = useRef<HTMLHeadingElement>(null)
  const read = useMemberAccess(controller, userId)
  const catalogue = useCapabilityCatalogue(controller)
  const access = read.error || !read.ready ? undefined : read.data
  const capabilities =
    catalogue.error || !catalogue.ready ? undefined : catalogue.data?.capabilities
  const ready = Boolean(access && capabilities)
  useEffect(() => {
    if (ready) heading.current?.focus()
  }, [ready])
  const labels = useAccessLabels(capabilities)
  const parts =
    access && capabilities
      ? splitItems(
          access.items,
          capabilities.map((entry) => entry.id)
        )
      : undefined
  const failed = Boolean(read.error || catalogue.error)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle ref={heading} tabIndex={-1}>
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {access ? (
              <>
                {access.member.name && (
                  <span className="block break-words font-medium text-foreground">
                    {access.member.name}
                  </span>
                )}
                <span className="block break-all">{access.member.email}</span>
              </>
            ) : (
              t('description')
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4">
          <ApiErrorAlert error={read.error ?? catalogue.error} />
          {access && capabilities && parts ? (
            <>
              <AccessNotes access={access} />
              <AccessRoles access={access} />
              <section aria-labelledby="member-access-items" className="space-y-3">
                <h3 id="member-access-items" className="text-base font-semibold">
                  {t('itemsTitle')}
                </h3>
                <AccessItems
                  parts={parts}
                  capabilities={capabilities}
                  labels={labels}
                  nameOf={roleNamer(access)}
                />
                <AccessInactive parts={parts} capabilities={capabilities} labels={labels} />
              </section>
              <OtherPermissions access={access} />
            </>
          ) : failed ? (
            <div className="space-y-2">
              <p role="status">{t('unavailable')}</p>
              <Button
                type="button"
                variant="outline"
                disabled={!read.ready || read.retryAt !== undefined}
                onClick={() => void controller.refresh().catch(() => undefined)}
              >
                {t('retry')}
              </Button>
            </div>
          ) : (
            <div role="status" aria-busy="true" className="space-y-3">
              <span className="sr-only">{t('loading')}</span>
              <Skeleton className="h-8 motion-reduce:animate-none" />
              <Skeleton className="h-40 motion-reduce:animate-none" />
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
