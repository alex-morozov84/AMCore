import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import {
  Building2Icon,
  CalendarClockIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  PlugZapIcon,
  ScrollTextIcon,
  UsersIcon,
} from 'lucide-react'

import {
  getConsoleApiKeysHref,
  getConsoleAuditHref,
  getConsoleBackgroundWorkHref,
  getConsoleIntegrationsHref,
  getConsoleOrganizationsHref,
  getConsoleOverviewHref,
  getConsoleScheduledJobsHref,
  getConsoleUsersHref,
} from '@/shared/lib/console-public-href'

export interface ConsoleNavItem {
  href: string
  label: string
  icon: ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false' }>
  prefetch?: boolean
}

/** Shared by the sidebar nav and the header breadcrumb - one source for both. */
export function useConsoleNavItems(): ConsoleNavItem[] {
  const t = useTranslations('console')
  return [
    { href: getConsoleOverviewHref(), label: t('overview'), icon: LayoutDashboardIcon },
    {
      href: getConsoleBackgroundWorkHref(),
      label: t('backgroundWork.title'),
      icon: ListChecksIcon,
      prefetch: false,
    },
    {
      href: getConsoleScheduledJobsHref(),
      label: t('scheduledJobs.title'),
      icon: CalendarClockIcon,
      prefetch: false,
    },
    {
      href: getConsoleIntegrationsHref(),
      label: t('integrations.title'),
      icon: PlugZapIcon,
      prefetch: false,
    },
    { href: getConsoleUsersHref(), label: t('users'), icon: UsersIcon },
    { href: getConsoleOrganizationsHref(), label: t('organizations'), icon: Building2Icon },
    {
      href: getConsoleApiKeysHref(),
      label: t('apiKeys.title'),
      icon: KeyRoundIcon,
      prefetch: false,
    },
    { href: getConsoleAuditHref(), label: t('auditTitle'), icon: ScrollTextIcon, prefetch: false },
  ]
}
