const LOCALE_APP = 'apps/web/src/app/[locale]'
const APP = 'apps/web/src/app'

export const LOCALE_PURE_MOVES = Object.freeze([
  '(dashboard)/error.tsx',
  '(dashboard)/layout.tsx',
  '(dashboard)/page.tsx',
  '(dashboard)/settings/sessions/page.tsx',
  'providers.tsx',
])

export const LOCALE_REWRITTEN_MOVES = Object.freeze([
  '(auth)/layout.tsx',
  '(auth)/forgot-password/page.tsx',
  '(auth)/login/page.tsx',
  '(auth)/register/page.tsx',
  '(auth)/resend-verification/page.tsx',
  '(auth)/reset-password/page.tsx',
  '(auth)/verify-email/page.tsx',
  'auth/callback/route.ts',
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
  LOCALE_APP,
])
