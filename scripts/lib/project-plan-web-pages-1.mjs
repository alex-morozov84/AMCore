// init:project --mode=single: the two auth pages with the simplest
// boilerplate (no searchParams, no redirectIfAuthenticated) that both move
// out from under [locale]/ and lose their locale-resolution boilerplate as
// part of that move. Split across several files (this one plus
// project-plan-web-pages-2.mjs/-3.mjs) to stay under the repo's
// ~150-line-per-file guidance for all the literal before/after text.
import path from 'node:path'
import { moveAndRewriteStep } from './init-engine.mjs'

const AUTH_OLD = 'apps/web/src/app/[locale]/(auth)'
const AUTH_NEW = 'apps/web/src/app/(auth)'

const FORGOT_PASSWORD_BEFORE = `import { setRequestLocale } from 'next-intl/server'

import { ForgotPasswordPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'

/**
 * Deliberately not gated by \`redirectIfAuthenticated()\` — a signed-in user
 * can still legitimately want to reset a password, and gating this page
 * alone while \`/reset-password\`/\`/verify-email\` stay open to authenticated
 * users (see those routes) would be an arbitrary asymmetry.
 */
export default async function ForgotPassword({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)

  return <ForgotPasswordPage />
}
`

const FORGOT_PASSWORD_AFTER = `import { ForgotPasswordPage } from '@/_pages/auth'

/**
 * Deliberately not gated by \`redirectIfAuthenticated()\` — a signed-in user
 * can still legitimately want to reset a password, and gating this page
 * alone while \`/reset-password\`/\`/verify-email\` stay open to authenticated
 * users (see those routes) would be an arbitrary asymmetry.
 */
export default async function ForgotPassword() {
  return <ForgotPasswordPage />
}
`

const RESEND_VERIFICATION_BEFORE = `import { setRequestLocale } from 'next-intl/server'

import { ResendVerificationPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'

/**
 * Not gated by \`redirectIfAuthenticated()\` — an already-signed-in but
 * unverified account has no other path to this action in the current
 * starter (login doesn't block on \`emailVerified\`, and there is no
 * dashboard-embedded resend affordance), so this page must stay reachable
 * either way.
 */
export default async function ResendVerification({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)

  return <ResendVerificationPage />
}
`

const RESEND_VERIFICATION_AFTER = `import { ResendVerificationPage } from '@/_pages/auth'

/**
 * Not gated by \`redirectIfAuthenticated()\` — an already-signed-in but
 * unverified account has no other path to this action in the current
 * starter (login doesn't block on \`emailVerified\`, and there is no
 * dashboard-embedded resend affordance), so this page must stay reachable
 * either way.
 */
export default async function ResendVerification() {
  return <ResendVerificationPage />
}
`

export function buildWebPagesSlice1Steps(root) {
  const pages = [
    ['forgot-password/page.tsx', FORGOT_PASSWORD_BEFORE, FORGOT_PASSWORD_AFTER],
    ['resend-verification/page.tsx', RESEND_VERIFICATION_BEFORE, RESEND_VERIFICATION_AFTER],
  ]

  return pages.map(([rel, expectedBefore, after]) =>
    moveAndRewriteStep(
      path.join(root, AUTH_OLD, rel),
      path.join(root, AUTH_NEW, rel),
      { expectedBefore, after },
      `move and drop locale-resolution boilerplate: (auth)/${rel}`
    )
  )
}
