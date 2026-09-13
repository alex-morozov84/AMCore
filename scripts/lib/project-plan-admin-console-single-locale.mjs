// Relocates the enabled console outside [locale] for --mode=single.
import path from 'node:path'
import { moveAndRewriteStep, moveFileStep } from './init-engine.mjs'

const LOCALE_CONSOLE = 'apps/web/src/app/[locale]/admin'
const APP = 'apps/web/src/app'

const LOGIN_BEFORE = `import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'

import { ConsoleLoginPage } from '@/_pages/console'
import { resolveLocaleParam } from '@/i18n/params'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

export const dynamic = 'force-dynamic'

export default async function ConsoleLogin({ params }: { params: Promise<{ locale: string }> }) {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') notFound()
  setRequestLocale(await resolveLocaleParam(params))
  return <ConsoleLoginPage />
}
`

const LOGIN_AFTER = `import { notFound } from 'next/navigation'

import { ConsoleLoginPage } from '@/_pages/console'
import { ADMIN_CONSOLE_CONFIG } from '@/shared/lib/admin-console.generated'

export const dynamic = 'force-dynamic'

export default async function ConsoleLogin() {
  if (ADMIN_CONSOLE_CONFIG.mode !== 'host') notFound()
  return <ConsoleLoginPage />
}
`

function consolePath(root, slug, relative = '') {
  return path.join(root, APP, slug, relative)
}

export function buildAdminConsoleSingleLocaleSteps(root, slug) {
  const source = path.join(root, LOCALE_CONSOLE)
  const moves = ['layout.tsx', '(protected)/layout.tsx', '(protected)/page.tsx'].map((relative) =>
    moveFileStep(
      path.join(source, relative),
      consolePath(root, slug, relative),
      `move console ${relative} outside locale routing`
    )
  )
  return [
    ...moves,
    moveAndRewriteStep(
      path.join(source, '(auth)/login/page.tsx'),
      consolePath(root, slug, '(auth)/login/page.tsx'),
      { expectedBefore: LOGIN_BEFORE, after: LOGIN_AFTER },
      'move console login and drop locale-resolution boilerplate'
    ),
  ]
}
