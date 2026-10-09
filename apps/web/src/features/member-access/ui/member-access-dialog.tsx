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

import { capabilityOf, groupByArea, roleNamer, splitItems } from '../model/access-view'

import { AccessNotes, UncoveredNote } from './access-notes'
import { AccessRow } from './access-row'

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
  const row = (item: NonNullable<typeof access>['items'][number]) => (
    <AccessRow
      key={item.key}
      item={item}
      label={labelOf(item.key)}
      nameOf={nameOf}
      fieldLabel={fieldLabel}
    />
  )
  const parts =
    access && capabilities
      ? splitItems(
          access.items,
          capabilities.map((entry) => entry.id)
        )
      : undefined
  const allowed = parts?.active.filter((item) => item.granted && !item.baseline).length ?? 0
  const blocked = parts?.active.filter((item) => !item.granted).length ?? 0
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
              <section aria-labelledby="member-access-roles" className="space-y-2">
                <h3 id="member-access-roles" className="text-base font-semibold">
                  {t('rolesTitle')}
                </h3>
                <RoleBadges roles={access.roles.items} empty={t('rolesNone')} />
                {access.roles.truncated && (
                  <p className="text-sm text-muted-foreground">
                    {t('rolesMore', { count: access.roles.total - access.roles.items.length })}
                  </p>
                )}
              </section>
              <section aria-labelledby="member-access-items" className="space-y-3">
                <h3 id="member-access-items" className="text-base font-semibold">
                  {t('itemsTitle')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('summaryAllowed', { count: allowed })}
                  {blocked > 0 && `, ${t('summaryBlocked', { count: blocked })}`}
                </p>
                {groupByArea(parts.active, capabilities).map(([area, items]) => (
                  <div key={area} className="space-y-2">
                    <h4 className="text-sm font-semibold">{text.area(area)}</h4>
                    <ul className="space-y-2">{items.map(row)}</ul>
                  </div>
                ))}
                {parts.inactive.length > 0 && (
                  <details className="rounded-lg border border-border p-3 text-sm">
                    <summary className="cursor-pointer font-medium">
                      {t('notAllowedTitle', { count: parts.inactive.length })}
                    </summary>
                    <p className="mt-2 text-muted-foreground">{t('notAllowedHint')}</p>
                    <ul className="mt-2 space-y-2">{parts.inactive.map(row)}</ul>
                  </details>
                )}
              </section>
              <UncoveredNote access={access} />
            </>
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
