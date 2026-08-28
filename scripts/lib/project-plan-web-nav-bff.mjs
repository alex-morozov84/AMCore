// init:project --mode=single: dal.ts's two locale-aware redirect() call
// sites and redirectIfAuthenticated()'s signature. Found while
// implementing, not named in the original plan — next-intl's
// `redirect({ href, locale })` object shape is a real logic change, not
// just an import swap. A single fileStep composing several
// replaceExactBlock calls, not exactContentStep, since dal.ts's function
// bodies are unrelated to this edit and a whole-file snapshot would make
// the step fail closed on any unrelated change to this file. Import order
// verified empirically — see project-plan-web-nav-links.mjs's header.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const IMPORTS_BEFORE = `import { cache } from 'react'
import { cookies } from 'next/headers'
import type { Locale } from 'next-intl'
import { getLocale } from 'next-intl/server'
import type { UserResponse } from '@amcore/shared'

import { redirect } from '@/i18n/navigation'

`

const IMPORTS_AFTER = `import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { UserResponse } from '@amcore/shared'

`

const REQUIRE_SESSION_REDIRECT_BEFORE = `  if (!session) {
    return redirect({ href: '/login', locale: await getLocale() })
  }
`

const REQUIRE_SESSION_REDIRECT_AFTER = `  if (!session) {
    return redirect('/login')
  }
`

const REDIRECT_IF_AUTHENTICATED_SIGNATURE_BEFORE =
  'export async function redirectIfAuthenticated(locale: Locale): Promise<void> {'
const REDIRECT_IF_AUTHENTICATED_SIGNATURE_AFTER =
  'export async function redirectIfAuthenticated(): Promise<void> {'

const REDIRECT_IF_AUTHENTICATED_CALL_BEFORE = `  if (session) {
    redirect({ href: '/', locale })
  }
`

const REDIRECT_IF_AUTHENTICATED_CALL_AFTER = `  if (session) {
    redirect('/')
  }
`

function dalTransform(content) {
  let next = replaceExactBlock(content, IMPORTS_BEFORE, IMPORTS_AFTER)
  next = replaceExactBlock(next, REQUIRE_SESSION_REDIRECT_BEFORE, REQUIRE_SESSION_REDIRECT_AFTER)
  next = replaceExactBlock(
    next,
    REDIRECT_IF_AUTHENTICATED_SIGNATURE_BEFORE,
    REDIRECT_IF_AUTHENTICATED_SIGNATURE_AFTER
  )
  return replaceExactBlock(
    next,
    REDIRECT_IF_AUTHENTICATED_CALL_BEFORE,
    REDIRECT_IF_AUTHENTICATED_CALL_AFTER
  )
}

export function buildWebNavBffSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/src/shared/api/bff/dal.ts'),
      dalTransform,
      'dal.ts: drop per-request locale from redirect() and redirectIfAuthenticated()'
    ),
  ]
}
