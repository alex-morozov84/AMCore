// init:project --mode=single: the two auth pages that keep `searchParams`
// but drop `params`/locale boilerplate. See project-plan-web-pages-1.mjs's
// header for why this is split across several files.
import path from 'node:path'
import { moveAndRewriteStep } from './init-engine.mjs'

const AUTH_OLD = 'apps/web/src/app/[locale]/(auth)'
const AUTH_NEW = 'apps/web/src/app/(auth)'

const RESET_PASSWORD_BEFORE = `import { setRequestLocale } from 'next-intl/server'

import { ResetPasswordPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'

/**
 * Not gated by \`redirectIfAuthenticated()\`: this route is \`AuthType.None\`
 * on the backend by design — a signed-in user can legitimately follow this
 * link (e.g. from a second tab), and the reset itself deletes every
 * session server-side regardless of who's currently logged in here.
 *
 * \`searchParams\` (not \`cookies()\`) is what makes this route dynamic —
 * confirmed against the installed Next docs
 * (\`node_modules/next/dist/docs/01-app/02-guides/production-checklist.md\`:
 * "Request-time APIs like \`cookies\` and the \`searchParams\` prop will opt
 * the entire route into Dynamic Rendering"). No explicit \`dynamic\` export
 * needed for that reason alone; Next types every search param as possibly
 * repeated, so a real duplicate \`?token=\` collapses to "no valid token"
 * below, the same state as a missing one.
 */
export default async function ResetPassword({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)

  const { token: rawToken } = await searchParams
  const token = typeof rawToken === 'string' ? rawToken : undefined

  return <ResetPasswordPage token={token} />
}
`

const RESET_PASSWORD_AFTER = `import { ResetPasswordPage } from '@/_pages/auth'

/**
 * Not gated by \`redirectIfAuthenticated()\`: this route is \`AuthType.None\`
 * on the backend by design — a signed-in user can legitimately follow this
 * link (e.g. from a second tab), and the reset itself deletes every
 * session server-side regardless of who's currently logged in here.
 *
 * \`searchParams\` (not \`cookies()\`) is what makes this route dynamic —
 * confirmed against the installed Next docs
 * (\`node_modules/next/dist/docs/01-app/02-guides/production-checklist.md\`:
 * "Request-time APIs like \`cookies\` and the \`searchParams\` prop will opt
 * the entire route into Dynamic Rendering"). No explicit \`dynamic\` export
 * needed for that reason alone; Next types every search param as possibly
 * repeated, so a real duplicate \`?token=\` collapses to "no valid token"
 * below, the same state as a missing one.
 */
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token: rawToken } = await searchParams
  const token = typeof rawToken === 'string' ? rawToken : undefined

  return <ResetPasswordPage token={token} />
}
`

const VERIFY_EMAIL_BEFORE = `import { setRequestLocale } from 'next-intl/server'

import { VerifyEmailPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'

/**
 * Not gated by \`redirectIfAuthenticated()\` — see \`reset-password/page.tsx\`'s
 * identical reasoning: \`AuthType.None\` on the backend by design, and a
 * signed-in user can legitimately follow this link too.
 *
 * \`searchParams\` makes this route dynamic on its own — see
 * \`reset-password/page.tsx\`'s comment for the exact doc citation.
 */
export default async function VerifyEmail({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)

  const { token: rawToken } = await searchParams
  const token = typeof rawToken === 'string' ? rawToken : undefined

  return <VerifyEmailPage token={token} />
}
`

const VERIFY_EMAIL_AFTER = `import { VerifyEmailPage } from '@/_pages/auth'

/**
 * Not gated by \`redirectIfAuthenticated()\` — see \`reset-password/page.tsx\`'s
 * identical reasoning: \`AuthType.None\` on the backend by design, and a
 * signed-in user can legitimately follow this link too.
 *
 * \`searchParams\` makes this route dynamic on its own — see
 * \`reset-password/page.tsx\`'s comment for the exact doc citation.
 */
export default async function VerifyEmail({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token: rawToken } = await searchParams
  const token = typeof rawToken === 'string' ? rawToken : undefined

  return <VerifyEmailPage token={token} />
}
`

export function buildWebPagesSlice2Steps(root) {
  const pages = [
    ['reset-password/page.tsx', RESET_PASSWORD_BEFORE, RESET_PASSWORD_AFTER],
    ['verify-email/page.tsx', VERIFY_EMAIL_BEFORE, VERIFY_EMAIL_AFTER],
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
