'use client'

import { useTranslations } from 'next-intl'

import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { SidebarMenuButton, SidebarMenuItem } from '@/shared/ui/sidebar'

import {
  organizationAccessHrefs,
  type OrganizationAccessPlacement,
  organizationAccessPlacement,
} from '../model/placement'

export function OrganizationNavigationEntry({
  placement = organizationAccessPlacement,
}: { placement?: OrganizationAccessPlacement } = {}) {
  const t = useTranslations('organizationAccess')
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={
          <RouteProgressLink href={organizationAccessHrefs(placement).menuHref} prefetch={false} />
        }
      >
        <span>{t('title')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
