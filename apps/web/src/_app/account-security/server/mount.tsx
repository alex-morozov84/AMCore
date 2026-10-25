import { headers } from 'next/headers'
import { getMessages } from 'next-intl/server'
import { productAdminPath } from '@amcore/shared'

import { AccountSecurityPage } from '@/_pages/account-security'
import { getOptionalSession, redirectToLogin, requireSession } from '@/shared/api/bff/dal'
import { resolveProductWebContext } from '@/shared/api/bff/product-web-context.server'

import { AccountSecurityClient } from '../ui/client'
import { AccountMfaMessages } from '../ui/message-scope'

import 'server-only'

export async function AccountSecurityMount({
  frontend = 'site',
  pending = false,
}: {
  frontend?: 'site' | 'admin'
  pending?: boolean
}) {
  const context = resolveProductWebContext(
    await headers(),
    frontend === 'site' ? 'site-auth' : 'admin-auth'
  )
  if (!pending) {
    if (frontend === 'site') await requireSession()
    else if (!(await getOptionalSession('admin-auth'))) await redirectToLogin(context.loginPath)
  }
  return (
    <AccountSecurityPage>
      <AccountMfaMessages messages={(await getMessages()).accountMfa}>
        <AccountSecurityClient
          key={`${context.audience}:${frontend}`}
          placement={{
            apiBase: frontend === 'site' ? '/auth/mfa' : '/product-admin/auth/mfa',
            logoutPath: frontend === 'site' ? '/auth/logout' : '/product-admin/auth/logout',
            passwordRecoveryHref:
              frontend === 'site' ? '/forgot-password' : productAdminPath('/forgot-password'),
            loginHref: context.loginPath,
            completeHref: frontend === 'site' ? '/' : productAdminPath('/organizations'),
          }}
        />
      </AccountMfaMessages>
    </AccountSecurityPage>
  )
}
