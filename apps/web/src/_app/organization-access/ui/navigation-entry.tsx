'use client'

import { useTranslations } from 'next-intl'

import { usePathname } from '@/i18n/navigation'
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
  const keys = useTranslations('ownApiKeys')
  const pathname = usePathname()
  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={pathname.startsWith(placement.organizationsPath)}
          render={
            <RouteProgressLink
              href={organizationAccessHrefs(placement).listHref}
              prefetch={false}
            />
          }
        >
          <span>{t('title')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {placement.ownApiKeysPath && (
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === placement.ownApiKeysPath}
            render={<RouteProgressLink href={placement.ownApiKeysPath} prefetch={false} />}
          >
            <span>{keys('title')}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </>
  )
}
