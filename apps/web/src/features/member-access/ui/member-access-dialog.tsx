'use client'
import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import {
  type OrganizationAccessController,
  useCapabilityCatalogue,
  useCatalogueText,
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
import { RoleBadges } from '@/shared/ui/role-badges'
import { Skeleton } from '@/shared/ui/skeleton'

import { capabilityOf, roleNamer } from '../model/access-view'

import { AccessNotes } from './access-notes'
import { AccessRow } from './access-row'

/**
 * What one member can do in this organization and why, as the server works it out from the same
 * rules it uses to authorize. Read-only; a failed read hides the answer instead of showing stale
 * facts, and a background reread keeps what is already shown.
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
  const text = useCatalogueText()
  const heading = useRef<HTMLHeadingElement>(null)
  const read = useMemberAccess(controller, userId)
  const catalogue = useCapabilityCatalogue(controller)
  const access = read.error ? undefined : read.data
  const capabilities = catalogue.error ? undefined : catalogue.data?.capabilities
  const ready = Boolean(access && capabilities)
  useEffect(() => {
    if (ready) heading.current?.focus()
  }, [ready])
  const nameOf = access ? roleNamer(access) : () => undefined
  const fieldLabel = (field: string): string => {
    const key = `fields.${field}` as Parameters<typeof t.has>[0]
    return t.has(key) ? t(key) : field
  }
  const labelOf = (key: string): string => {
    const found = capabilityOf(
      key,
      (capabilities ?? []).map((entry) => entry.id)
    )
    const capability = capabilities?.find((entry) => entry.id === found?.id)
    const base = (capability && text.capability(capability.labelKey)?.label) ?? found?.id ?? key
    return found?.field ? t('fieldOf', { capability: base, field: fieldLabel(found.field) }) : base
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
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
        <ApiErrorAlert error={read.error ?? catalogue.error} />
        {access && capabilities ? (
          <div className="space-y-4">
            <AccessNotes access={access} />
            <section aria-labelledby="member-access-roles" className="space-y-2">
              <h3 id="member-access-roles" className="text-base font-semibold">
                {t('rolesTitle')}
              </h3>
              {access.roles.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('rolesNone')}</p>
              ) : (
                <RoleBadges roles={access.roles.items} empty={t('rolesNone')} />
              )}
              {access.roles.truncated && (
                <p className="text-sm text-muted-foreground">
                  {t('rolesMore', { count: access.roles.total - access.roles.items.length })}
                </p>
              )}
            </section>
            <section aria-labelledby="member-access-items" className="space-y-2">
              <h3 id="member-access-items" className="text-base font-semibold">
                {t('itemsTitle')}
              </h3>
              <ul className="space-y-2">
                {access.items.map((item) => (
                  <AccessRow
                    key={item.key}
                    item={item}
                    label={labelOf(item.key)}
                    nameOf={nameOf}
                    fieldLabel={fieldLabel}
                  />
                ))}
              </ul>
            </section>
          </div>
        ) : read.error || catalogue.error ? (
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
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
