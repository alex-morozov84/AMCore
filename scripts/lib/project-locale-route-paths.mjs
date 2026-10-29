const LOCALE_APP = 'apps/web/src/app/[locale]'
const APP = 'apps/web/src/app'

export const LOCALE_PURE_MOVES = Object.freeze([
  '(auth)/invite/flow/[flowId]/loading.tsx',
  '(auth)/layout.tsx',
  '(dashboard)/error.tsx',
  '(dashboard)/layout.tsx',
  '(dashboard)/page.tsx',
  '(dashboard)/settings/sessions/page.tsx',
  '(organization-access)/error.tsx',
  '(organization-access)/layout.tsx',
  '(product-admin)/manage/(auth)/auth/linked/page.tsx',
  '(product-admin)/manage/(auth)/forgot-password/page.tsx',
  '(product-admin)/manage/(auth)/invite/flow/[flowId]/loading.tsx',
  '(product-admin)/manage/(auth)/layout.tsx',
  '(product-admin)/manage/(auth)/login/page.tsx',
  '(product-admin)/manage/(auth)/sign-in-again/page.tsx',
  '(product-admin)/manage/(auth)/resend-verification/page.tsx',
  '(product-admin)/manage/(auth)/reset-password/page.tsx',
  '(product-admin)/manage/(auth)/verify-email/page.tsx',
  '(product-admin)/manage/(protected)/layout.tsx',
  '(product-admin)/manage/(protected)/organizations/[id]/invites/page.tsx',
  '(product-admin)/manage/(protected)/organizations/[id]/members/page.tsx',
  '(product-admin)/manage/(protected)/organizations/[id]/page.tsx',
  '(product-admin)/manage/(protected)/organizations/[id]/roles/[roleId]/page.tsx',
  '(product-admin)/manage/(protected)/organizations/[id]/roles/page.tsx',
  '(product-admin)/manage/(protected)/organizations/page.tsx',
  '(product-admin)/manage/(protected)/page.tsx',
  '(product-admin)/manage/(protected)/settings/api-keys/page.tsx',
  '(product-admin)/manage/(protected)/settings/sessions/page.tsx',
  '(product-admin)/manage/layout.tsx',
  '(product-admin)/manage/not-found.tsx',
  'providers.tsx',
])

export const LOCALE_REWRITTEN_MOVES = Object.freeze([
  '(auth)/mfa/page.tsx',
  '(auth)/sign-in-again/page.tsx',
  '(dashboard)/account/security/page.tsx',
  '(product-admin)/manage/(auth)/mfa/page.tsx',
  '(product-admin)/manage/(protected)/account/security/page.tsx',

  '(auth)/forgot-password/page.tsx',
  '(auth)/invite/accept/route.ts',
  '(auth)/invite/bootstrap/[pendingId]/route.ts',
  '(auth)/invite/flow/[flowId]/page.tsx',
  '(auth)/invite/unusable/page.tsx',
  '(auth)/login/page.tsx',
  '(auth)/register/page.tsx',
  '(auth)/resend-verification/page.tsx',
  '(auth)/reset-password/page.tsx',
  '(auth)/verify-email/page.tsx',
  '(dashboard)/settings/api-keys/route.ts',
  '(organization-access)/organizations/[id]/invites/route.ts',
  '(organization-access)/organizations/[id]/members/route.ts',
  '(organization-access)/organizations/[id]/roles/[roleId]/route.ts',
  '(organization-access)/organizations/[id]/roles/route.ts',
  '(organization-access)/organizations/[id]/route.ts',
  '(organization-access)/organizations/route.ts',
  '(product-admin)/manage/(auth)/invite/accept/route.ts',
  '(product-admin)/manage/(auth)/invite/bootstrap/[pendingId]/route.ts',
  '(product-admin)/manage/(auth)/invite/flow/[flowId]/page.tsx',
  '(product-admin)/manage/(auth)/invite/unusable/page.tsx',
  '(product-admin)/manage/auth/callback/page.tsx',
  'auth/callback/page.tsx',
  'layout.tsx',
])

export const localeRouteMove = (relative) => ({
  from: `${LOCALE_APP}/${relative}`,
  to: `${APP}/${relative}`,
})

export const LOCALE_DELETES = Object.freeze([
  'apps/web/src/i18n/routing.ts',
  'apps/web/src/i18n/navigation.ts',
  'apps/web/src/i18n/params.ts',
  'apps/web/src/features/locale-switcher',
  'apps/web/src/shared/ui/locale-selector.tsx',
  'apps/web/src/shared/ui/locale-selector.stories.tsx',
  // Console-only switcher (widgets/console-shell survives single-locale
  // mode; only this one file inside it needs to go, since it has nothing
  // left to switch between and its navigation call cannot type-check
  // against the single-locale router shape - see
  // `removeConsoleLocaleSwitcher` in project-locale-navigation-ui.mjs).
  'apps/web/src/widgets/console-shell/ui/ConsoleLocaleSwitcher.tsx',
  'apps/web/src/widgets/console-shell/ui/ConsoleLocaleSwitcher.test.tsx',
  LOCALE_APP,
])
