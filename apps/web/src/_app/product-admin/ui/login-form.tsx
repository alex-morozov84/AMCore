'use client'

import { productAdminPath, type SupportedLocale } from '@amcore/shared'

import { LoginForm } from '@/features/auth-login'
import { authActions } from '@/shared/api/auth-api'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

const actions = authActions('/product-admin/auth')

/** Only the application composition selects where successful authentication continues. */
export function ProductAdminLoginForm({
  destination,
  targetLocale,
}: {
  destination: string
  targetLocale?: SupportedLocale
}) {
  const router = useRouteProgressRouter()
  return (
    <LoginForm
      forgotPasswordHref={productAdminPath('/forgot-password')}
      adapter={{
        submit: actions.login,
        isCurrent: () => true,
        onMfaRequired: (flowBinding) =>
          router.replace(`${productAdminPath('/mfa')}?flow=${encodeURIComponent(flowBinding)}`),
        onSuccess: ({ user }) =>
          router.replace(destination, { locale: targetLocale ?? user.locale }),
      }}
    />
  )
}
