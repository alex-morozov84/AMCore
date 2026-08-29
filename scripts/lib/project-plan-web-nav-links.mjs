// init:project --mode=single: files whose only change is the Link import
// (named export from @/i18n/navigation -> default export from next/link).
// The JSX usage (<Link href="/some/path">) is identical either way, since
// every call site here already passes a plain string href with no `locale`
// prop. The import doesn't just change text in place — simple-import-sort
// puts a bare `next/link` default import in a different position than the
// `@/i18n/navigation` named import it replaces, and that position isn't
// obvious by inspection (verified per file by running the real `eslint
// --fix` against a disposable copy, not guessed — see ai/models-talk.md).
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const LINK_IMPORT = "import { Link } from '@/i18n/navigation'\n"
const NEXT_INTL_IMPORT = "import { useTranslations } from 'next-intl'\n"

// Verified empirically (real eslint --fix against a disposable copy, not
// guessed): `import Link from 'next/link'` sorts immediately before the
// `next-intl` import in every one of these files, whether or not a `react`
// import precedes it.
function swapLinkImport(content) {
  return replaceExactBlock(
    replaceExactBlock(content, LINK_IMPORT, ''),
    NEXT_INTL_IMPORT,
    `import Link from 'next/link'\n${NEXT_INTL_IMPORT}`
  )
}

const RELATIVE_PATHS = [
  'apps/web/src/features/auth-reset-password/ui/ResetPasswordForm.tsx',
  'apps/web/src/features/auth-verify-email/ui/VerifyEmailStatus.tsx',
  'apps/web/src/features/auth-login/ui/LoginForm.tsx',
  'apps/web/src/_pages/auth/LoginPage/LoginPage.tsx',
  'apps/web/src/_pages/auth/ForgotPasswordPage/ForgotPasswordPage.tsx',
  'apps/web/src/_pages/auth/ResendVerificationPage/ResendVerificationPage.tsx',
  'apps/web/src/_pages/auth/RegisterPage/RegisterPage.tsx',
]

export function buildWebNavLinkSteps(root) {
  return RELATIVE_PATHS.map((rel) =>
    fileStep(
      path.join(root, rel),
      swapLinkImport,
      `swap the Link import for next/link's default export: ${rel}`
    )
  )
}
