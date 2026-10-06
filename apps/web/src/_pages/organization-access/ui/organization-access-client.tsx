'use client'

import { useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'
import { RefreshCw } from 'lucide-react'

import {
  type OrganizationContextInput,
  useOrganizationContext,
} from '@/entities/organization-context'
import { OrganizationSelect } from '@/features/organization-select'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { BackLink } from '@/shared/ui/back-link'
import { Button } from '@/shared/ui/button'
import { PageTitle } from '@/shared/ui/page-title'
import { SectionNavigation } from '@/shared/ui/section-navigation'
import { OrganizationContextSummary } from '@/widgets/organization-context-summary'

import { useAccessNavigation } from '../model/use-access-navigation'

import { OrganizationAccessFailure } from './context-failure'
import { OrganizationAccessSkeleton } from './context-skeleton'

export interface OrganizationAccessClientProps {
  initialOrganizationName?: string
  initialCanManageTeamAccess?: boolean
  admission: ProductAccessBootstrap
  input: OrganizationContextInput
  explicitList: boolean
  membersHref?: (id: string) => string
  invitationsHref?: (id: string) => string
  contextHref: (id: string) => string
  pageHref: (page: number) => string
  listHref: string
  loginHref: string
  dashboardHref: string
  onReplace: (href: string) => void
  onReload: () => void
}

export function OrganizationAccessClient(props: OrganizationAccessClientProps) {
  const t = useTranslations('organizationAccess')
  const membersT = useTranslations('organizationMembers')
  const invitesT = useTranslations('organizationInvitations')
  const { admission, input } = props
  const { state, data, refresh, initialPending } = useOrganizationContext(admission.binding, input)
  const navigation = useAccessNavigation({ ...props, state, data, refresh })
  const { heading, selected, list, context, inconsistent, autoOpen } = navigation
  const pending = state.status === 'pending' || autoOpen
  const title = selected
    ? (context?.organization.name ?? (initialPending ? props.initialOrganizationName : undefined))
    : t('title')
  const sectionId = context?.canManageTeamAccess
    ? context.organization.id
    : initialPending && props.initialCanManageTeamAccess && input.kind === 'selected'
      ? input.id
      : undefined
  const refreshDisabled =
    pending || Boolean(state.retryAt) || state.status === 'changed' || state.status === 'missing'

  return (
    <section className="space-y-6">
      {selected && <BackLink href={props.listHref}>{t('all')}</BackLink>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <PageTitle
            ref={heading}
            tabIndex={-1}
            className="break-words text-2xl font-semibold tracking-tight outline-none"
          >
            {title}
          </PageTitle>
          {!selected && <p className="text-muted-foreground">{t('choose')}</p>}
        </div>
        <Button variant="outline" disabled={refreshDisabled} onClick={navigation.refresh}>
          <RefreshCw
            aria-hidden="true"
            className={pending ? 'animate-spin motion-reduce:animate-none' : ''}
          />
          {pending ? t('checking') : t('refresh')}
        </Button>
      </div>
      {sectionId && props.membersHref && (
        <SectionNavigation
          label={membersT('sections')}
          items={[
            {
              label: membersT('overview'),
              href: props.contextHref(sectionId),
              active: true,
            },
            {
              label: membersT('title'),
              href: props.membersHref(sectionId),
              active: false,
            },
            ...(props.invitationsHref
              ? [
                  {
                    label: invitesT('title'),
                    href: props.invitationsHref(sectionId),
                    active: false,
                  },
                ]
              : []),
          ]}
        />
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {pending
          ? selected
            ? t('checking')
            : t('loading')
          : state.status === 'ready'
            ? t('loaded')
            : t('failed')}
      </div>
      <div aria-busy={pending}>
        {pending ? (
          <OrganizationAccessSkeleton selected={selected} />
        ) : state.status !== 'ready' ? (
          <OrganizationAccessFailure
            state={state}
            listHref={props.listHref}
            loginHref={props.loginHref}
            onReload={props.onReload}
          />
        ) : inconsistent ? (
          <Alert>
            <AlertDescription>{t('inconsistent')}</AlertDescription>
          </Alert>
        ) : list ? (
          <OrganizationSelect
            list={list}
            contextHref={props.contextHref}
            pageHref={props.pageHref}
            dashboardHref={props.dashboardHref}
          />
        ) : context ? (
          <div className="space-y-4">
            <OrganizationContextSummary context={context} email={admission.actor.email} />
          </div>
        ) : null}
      </div>
    </section>
  )
}
