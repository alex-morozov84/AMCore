// init:project --mode=single: the (auth) group layout (loses
// <LocaleSwitcher />) and the OAuth callback route handler (loses its
// locale segment and validation entirely). The root layout is a separate
// file (project-plan-web-root-layout.mjs) — see this repo's
// ~150-line-per-file guidance.
import path from 'node:path'
import { moveAndRewriteStep } from './init-engine.mjs'

const LOCALE_APP = 'apps/web/src/app/[locale]'
const APP = 'apps/web/src/app'

const AUTH_LAYOUT_BEFORE = `import type { ReactNode } from 'react'

import { LocaleSwitcher } from '@/features/locale-switcher'

interface AuthLayoutProps {
  children: ReactNode
}

/**
 * The "already authenticated? redirect to /" check lives in each page
 * (\`login/page.tsx\`, \`register/page.tsx\` — \`redirectIfAuthenticated\`), not
 * here: same partial-rendering reasoning as \`(dashboard)\`'s layout/page
 * split (see \`dal.ts\`), just lower-stakes — there's no protected data to
 * leak either way, only a redundant form render if it's ever missed.
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {children}
      <LocaleSwitcher />
    </main>
  )
}
`

const AUTH_LAYOUT_AFTER = `import type { ReactNode } from 'react'

interface AuthLayoutProps {
  children: ReactNode
}

/**
 * The "already authenticated? redirect to /" check lives in each page
 * (\`login/page.tsx\`, \`register/page.tsx\` — \`redirectIfAuthenticated\`), not
 * here: same partial-rendering reasoning as \`(dashboard)\`'s layout/page
 * split (see \`dal.ts\`), just lower-stakes — there's no protected data to
 * leak either way, only a redundant form render if it's ever missed.
 */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {children}
    </main>
  )
}
`

const OAUTH_CALLBACK_BEFORE = `import { hasLocale } from 'next-intl'

import { routing } from '@/i18n/routing'
import { handleOAuthExchange } from '@/shared/api/bff/oauth-exchange-handler'

/**
 * A Route Handler, not a page: cookies can only be set from a Server Action
 * or a Route Handler, never during a Server Component's render — see
 * \`oauth-exchange-handler.ts\`. The backend always constructs this URL with
 * the account's own stored locale (\`coerceSupportedLocale\`), but this
 * endpoint is reachable directly, so it's still validated rather than trusted.
 */
export async function GET(request: Request, context: { params: Promise<{ locale: string }> }) {
  const { locale } = await context.params
  if (!hasLocale(routing.locales, locale)) {
    return new Response('Not Found', { status: 404 })
  }

  return handleOAuthExchange(request, locale)
}
`

const OAUTH_CALLBACK_AFTER = `import { handleOAuthExchange } from '@/shared/api/bff/oauth-exchange-handler'

/**
 * A Route Handler, not a page: cookies can only be set from a Server Action
 * or a Route Handler, never during a Server Component's render — see
 * \`oauth-exchange-handler.ts\`.
 */
export async function GET(request: Request) {
  return handleOAuthExchange(request)
}
`

export function buildWebLayoutSteps(root) {
  return [
    moveAndRewriteStep(
      path.join(root, LOCALE_APP, '(auth)/layout.tsx'),
      path.join(root, APP, '(auth)/layout.tsx'),
      { expectedBefore: AUTH_LAYOUT_BEFORE, after: AUTH_LAYOUT_AFTER },
      'move (auth)/layout.tsx and remove <LocaleSwitcher />'
    ),
    moveAndRewriteStep(
      path.join(root, LOCALE_APP, 'auth/callback/route.ts'),
      path.join(root, APP, 'auth/callback/route.ts'),
      { expectedBefore: OAUTH_CALLBACK_BEFORE, after: OAUTH_CALLBACK_AFTER },
      'move auth/callback/route.ts and drop its locale segment/validation'
    ),
  ]
}
