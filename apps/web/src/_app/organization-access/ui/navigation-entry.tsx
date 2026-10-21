'use client'

import { useTranslations } from 'next-intl'
import { Building2Icon, KeyRoundIcon } from 'lucide-react'

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
          tooltip={t('title')}
          isActive={pathname.startsWith(placement.organizationsPath)}
          render={
            <RouteProgressLink
              href={organizationAccessHrefs(placement).listHref}
              prefetch={false}
            />
          }
        >
          <Building2Icon aria-hidden="true" />
          <span>{t('title')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {placement.ownApiKeysPath && (
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={keys('title')}
            isActive={pathname === placement.ownApiKeysPath}
            render={<RouteProgressLink href={placement.ownApiKeysPath} prefetch={false} />}
          >
            <KeyRoundIcon aria-hidden="true" />
            <span>{keys('title')}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </>
  )
}
