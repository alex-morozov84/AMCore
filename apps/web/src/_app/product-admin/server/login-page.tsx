import { headers } from 'next/headers'
import { getLocale, getTranslations } from 'next-intl/server'
import { parseProductAdminReturn, productAdminPath, productAdminReturnPath } from '@amcore/shared'

import { LoginPage } from '@/_pages/auth'
import { redirect } from '@/i18n/navigation'
import { getOptionalSession } from '@/shared/api/bff/dal'
import { getOAuthProviders } from '@/shared/api/bff/oauth-providers'
import { resolveProductWebContext } from '@/shared/api/bff/product-web-context.server'

import { ProductAdminLoginForm } from '../ui/login-form'

import 'server-only'

export async function ProductAdminLoginPage({
  query,
}: {
  query: { returnTo?: string | string[]; oauthError?: string | string[] }
}) {
  // The literal route and actual host select the context before any session read.
  resolveProductWebContext(await headers(), 'admin-auth')
  const target = parseProductAdminReturn(query.returnTo)
  const destination = target ? productAdminReturnPath(target) : productAdminPath('/organizations')
  let signedIn = false
  try {
    signedIn = Boolean(await getOptionalSession('admin-auth'))
  } catch {
    // Match the site's public-login behavior: an unavailable session store must
    // not hide the form. Submission still fails closed in the auth handler.
    console.error('[admin login] session lookup unavailable')
  }
  if (signedIn) redirect({ href: destination, locale: target?.locale ?? (await getLocale()) })
  const providers = await getOAuthProviders()
  const t = await getTranslations('productAdmin')
  const params = new URLSearchParams({ locale: await getLocale() })
  if (target) params.set('returnTo', JSON.stringify(target))
  const links = Object.fromEntries(
    ['google', 'github', 'apple'].map((provider) => [
      provider,
      `/api/product-admin/auth/oauth/${provider}?${params}`,
    ])
  )
  return (
    <LoginPage
      title={t('loginTitle')}
      oauthProviders={providers}
      oauthLinks={links}
      oauthError={query.oauthError}
      publicSignupEnabled={false}
      loginForm={<ProductAdminLoginForm destination={destination} targetLocale={target?.locale} />}
    />
  )
}
