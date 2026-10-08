'use client'
import { useLocale, useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'

import {
  useCapabilityCatalogue,
  useOrganizationContext,
  useRoleDefinition,
} from '@/entities/organization-context'
import { RoleEditor } from '@/features/role-editor'
import { getErrorCode } from '@/shared/api/errors'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { BackLink } from '@/shared/ui/back-link'
import { Button } from '@/shared/ui/button'
import { PageTitle } from '@/shared/ui/page-title'
import { Skeleton } from '@/shared/ui/skeleton'
import { OrganizationSectionNav } from '@/widgets/organization-nav'

/** One role: loads its atomic snapshot and the capability catalogue, edits through the feature. */
export function OrganizationRoleClient({
  admission,
  organizationId,
  roleId,
  initialOrganizationName,
  hrefs,
}: {
  admission: ProductAccessBootstrap
  organizationId: string
  roleId: string
  initialOrganizationName?: string
  hrefs: React.ComponentProps<typeof OrganizationSectionNav>['hrefs'] & { roles: string }
}) {
  const router = useRouteProgressRouter()
  const locale = useLocale()
  const t = useTranslations('organizationRoles')
  const access = useOrganizationContext(admission.binding, {
    kind: 'selected',
    id: organizationId,
    locale,
  })
  const role = useRoleDefinition(access.controller, roleId)
  const catalogue = useCapabilityCatalogue(access.controller)
  // A background reread or an authority recheck keeps the editor (and any draft) in place; only a
  // failed read or really lost authority hides it, so stale data is never shown as current.
  const authorityLost = !['pending', 'ready'].includes(access.state.status)
  const detail = !authorityLost && !role.error ? role.data : undefined
  const capabilities = !authorityLost && !catalogue.error ? catalogue.data?.capabilities : undefined
  const missing = getErrorCode(role.error) === 'ROLE_UNAVAILABLE'
  const failed = Boolean(role.error ?? catalogue.error)
  const name =
    access.data && 'organization' in access.data.data
      ? access.data.data.organization.name
      : access.initialPending
        ? initialOrganizationName
        : undefined
  return (
    <section className="space-y-6">
      <BackLink href={hrefs.roles}>{t('backToRoles')}</BackLink>
      <PageTitle>{detail?.role.name ?? name}</PageTitle>
      {name && detail && <p className="text-sm text-muted-foreground">{name}</p>}
      <OrganizationSectionNav active="roles" hrefs={hrefs} />
      <ApiErrorAlert error={access.state.error ?? role.error ?? catalogue.error} />
      {missing && <p role="status">{t('notFound')}</p>}
      {failed && !missing && (
        <div className="space-y-2">
          <p role="status">{t('readUnavailable2')}</p>
          <Button
            variant="outline"
            onClick={() => void access.controller.refresh().catch(() => undefined)}
          >
            {t('reload')}
          </Button>
        </div>
      )}
      {!failed && (!detail || !capabilities) && (
        <div role="status" aria-busy="true" className="space-y-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-10 motion-reduce:animate-none" />
          <Skeleton className="h-48 motion-reduce:animate-none" />
        </div>
      )}
      {detail?.editMode === 'system' && <p role="status">{t('builtinNotice')}</p>}
      {detail?.editMode === 'oversized' && <p role="status">{t('oversizedNotice')}</p>}
      {detail && capabilities && (
        <RoleEditor
          key={`${admission.binding}:${organizationId}:${roleId}`}
          role={role}
          detail={detail}
          capabilities={capabilities}
          holderHref={(email) =>
            `${hrefs.members ?? hrefs.overview}?search=${encodeURIComponent(email)}`
          }
          onDeleted={() => router.push(hrefs.roles)}
          onLeave={(href) => router.push(href)}
          onReview={() => void role.refresh().catch(() => undefined)}
        />
      )}
    </section>
  )
}
