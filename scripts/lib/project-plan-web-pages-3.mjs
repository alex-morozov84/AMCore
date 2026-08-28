// init:project --mode=single: login and register, the two auth pages that
// call redirectIfAuthenticated() — its signature drops the locale argument
// entirely once dal.ts's own rewrite lands (project-plan-web-nav.mjs). See
// project-plan-web-pages-1.mjs's header for why this is split across files.
import path from 'node:path'
import { moveAndRewriteStep } from './init-engine.mjs'

const AUTH_OLD = 'apps/web/src/app/[locale]/(auth)'
const AUTH_NEW = 'apps/web/src/app/(auth)'

const LOGIN_BEFORE = `import { setRequestLocale } from 'next-intl/server'

import { LoginPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'
import { redirectIfAuthenticated } from '@/shared/api/bff/dal'
import { getOAuthProviders } from '@/shared/api/bff/oauth-providers'

// \`redirectIfAuthenticated()\` reads \`cookies()\` — see the identical export
// on \`(dashboard)/page.tsx\` for why this avoids build-time noise.
export const dynamic = 'force-dynamic'

export default async function Login({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ oauthError?: string | string[] }>
}) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)
  await redirectIfAuthenticated(locale)

  const [oauthProviders, { oauthError }] = await Promise.all([getOAuthProviders(), searchParams])

  return <LoginPage oauthProviders={oauthProviders} oauthError={oauthError} />
}
`

const LOGIN_AFTER = `import { LoginPage } from '@/_pages/auth'
import { redirectIfAuthenticated } from '@/shared/api/bff/dal'
import { getOAuthProviders } from '@/shared/api/bff/oauth-providers'

// \`redirectIfAuthenticated()\` reads \`cookies()\` — see the identical export
// on \`(dashboard)/page.tsx\` for why this avoids build-time noise.
export const dynamic = 'force-dynamic'

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ oauthError?: string | string[] }>
}) {
  await redirectIfAuthenticated()

  const [oauthProviders, { oauthError }] = await Promise.all([getOAuthProviders(), searchParams])

  return <LoginPage oauthProviders={oauthProviders} oauthError={oauthError} />
}
`

const REGISTER_BEFORE = `import { setRequestLocale } from 'next-intl/server'

import { RegisterPage } from '@/_pages/auth'
import { resolveLocaleParam } from '@/i18n/params'
import { redirectIfAuthenticated } from '@/shared/api/bff/dal'
import { getOAuthProviders } from '@/shared/api/bff/oauth-providers'

// \`redirectIfAuthenticated()\` reads \`cookies()\` — see the identical export
// on \`(dashboard)/page.tsx\` for why this avoids build-time noise.
export const dynamic = 'force-dynamic'

export default async function Register({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocaleParam(params)
  setRequestLocale(locale)
  await redirectIfAuthenticated(locale)

  const oauthProviders = await getOAuthProviders()

  return <RegisterPage oauthProviders={oauthProviders} />
}
`

const REGISTER_AFTER = `import { RegisterPage } from '@/_pages/auth'
import { redirectIfAuthenticated } from '@/shared/api/bff/dal'
import { getOAuthProviders } from '@/shared/api/bff/oauth-providers'

// \`redirectIfAuthenticated()\` reads \`cookies()\` — see the identical export
// on \`(dashboard)/page.tsx\` for why this avoids build-time noise.
export const dynamic = 'force-dynamic'

export default async function Register() {
  await redirectIfAuthenticated()

  const oauthProviders = await getOAuthProviders()

  return <RegisterPage oauthProviders={oauthProviders} />
}
`

export function buildWebPagesSlice3Steps(root) {
  const pages = [
    ['login/page.tsx', LOGIN_BEFORE, LOGIN_AFTER],
    ['register/page.tsx', REGISTER_BEFORE, REGISTER_AFTER],
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
