'use client'

import { useLocale, useTranslations } from 'next-intl'
import { coerceSupportedLocale, localizedFrontendUrl, productAdminPath } from '@amcore/shared'
import { GlobeIcon } from 'lucide-react'

import { authActions } from '@/shared/api/auth-api'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/shared/ui/sidebar'
import { AccountMenu } from '@/widgets/account-menu'

const actions = authActions('/product-admin/auth')

export function ProductAdminSiteLink({ siteOrigin }: { siteOrigin: string }) {
  const t = useTranslations('productAdmin')
  const locale = coerceSupportedLocale(useLocale())
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* This may cross hosts and must start a new document with its own session. */}
        <SidebarMenuButton
          tooltip={t('visitSite')}
          render={<a href={localizedFrontendUrl(siteOrigin, locale, '/')} />}
        >
          <GlobeIcon aria-hidden="true" />
          <span>{t('visitSite')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function ProductAdminHeader() {
  return (
    <AccountMenu
      logoutOptions={{ submit: actions.logout, loginHref: productAdminPath('/login') }}
    />
  )
}
