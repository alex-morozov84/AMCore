'use client'

import { useTranslations } from 'next-intl'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { SidebarMenuButton, SidebarMenuItem } from '@/shared/ui/sidebar'

export function OrganizationNavigationEntry() {
  const t = useTranslations('organizationAccess')
  return (
    <SidebarMenuItem>
      <SidebarMenuButton render={<RouteProgressLink href="/organizations" prefetch={false} />}>
        <span>{t('title')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
