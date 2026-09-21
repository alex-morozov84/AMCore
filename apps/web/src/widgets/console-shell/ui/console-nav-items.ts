import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import { Building2Icon, LayoutDashboardIcon, UsersIcon } from 'lucide-react'

import {
  getConsoleOrganizationsHref,
  getConsoleOverviewHref,
  getConsoleUsersHref,
} from '@/shared/lib/console-public-href'

export interface ConsoleNavItem {
  href: string
  label: string
  icon: ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false' }>
}

/** Shared by the sidebar nav and the header breadcrumb - one source for both. */
export function useConsoleNavItems(): ConsoleNavItem[] {
  const t = useTranslations('console')
  return [
    { href: getConsoleOverviewHref(), label: t('overview'), icon: LayoutDashboardIcon },
    { href: getConsoleUsersHref(), label: t('users'), icon: UsersIcon },
    { href: getConsoleOrganizationsHref(), label: t('organizations'), icon: Building2Icon },
  ]
}
