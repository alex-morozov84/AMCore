'use client'
import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import {
  type OrganizationAccessController,
  useMemberRoleAssignments,
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

import { MemberRoleForm } from './role-form'

export function MemberRoleDialog({
  controller,
  userId,
  actorId,
  onClose,
}: {
  controller: OrganizationAccessController
  userId: string
  actorId: string
  onClose: () => void
}) {
  const t = useTranslations('organizationMembers')
  const heading = useRef<HTMLHeadingElement>(null)
  const roles = useMemberRoleAssignments(controller, {
    userId,
    page: 1,
    search: '',
    section: 'available',
  })
  const hasSnapshot = Boolean(roles.data)
  useEffect(() => {
    if (hasSnapshot) heading.current?.focus()
  }, [hasSnapshot])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !roles.busy) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle ref={heading} tabIndex={-1}>
            {t('edit')}
          </DialogTitle>
          <DialogDescription>
            {roles.data?.member.user.name && (
              <span className="block break-words font-medium text-foreground">
                {roles.data.member.user.name}
              </span>
            )}
            <span className="block break-all">
              {roles.data?.member.user.email ??
                (roles.pending ? t('loading') : t('readUnavailable'))}
            </span>
          </DialogDescription>
        </DialogHeader>
        <ApiErrorAlert error={roles.error} />
        {roles.data ? (
          <MemberRoleForm
            key={roles.data.member.memberId}
            controller={controller}
            userId={userId}
            initial={roles.data}
            isSelf={userId === actorId}
            onClose={onClose}
          />
        ) : (
          <div className="space-y-4">
            {roles.pending ? (
              <>
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-64" />
                <span role="status" className="sr-only">
                  {t('loading')}
                </span>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={!roles.ready || roles.retryAt !== undefined || roles.busy}
                onClick={() => void roles.refresh().catch(() => undefined)}
              >
                {t('retry')}
              </Button>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={roles.busy} onClick={onClose}>
                {t('close')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
