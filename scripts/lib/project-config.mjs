// Path/mode tables for init:project, mirroring brand-config.mjs's role for
// init:brand.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { EngineError } from './actions.mjs'

/** `multi` is the implicit starting state; `single` is the only automated
 * destination for v1 (ADR-071) — adding a locale stays a manual recipe. */
export const PROJECT_MODES = ['single']

/**
 * The reinitialize guard (ADR-071): every individual step here fails closed
 * on a re-run too (exactContentStep/fileStep read the file they expect to
 * still exist), but with a raw ENOENT rather than an explanation. Checking
 * the one directory every step in this transform ultimately empties gives a
 * single clear error up front instead of whichever step happens to hit the
 * missing file first.
 */
export function assertMultiLocaleAppStructure(root) {
  const localeDir = path.join(root, 'apps/web/src/app/[locale]')
  if (!existsSync(localeDir)) {
    throw new EngineError(
      `${localeDir} does not exist — either init:project --mode=single has already been ` +
        'applied to this checkout, or this is not an AMCore checkout with the default ' +
        'multi-locale app structure.'
    )
  }
}

const PRISMA_LOCALE_DEFAULT_NOTE =
  'apps/api/prisma/user.prisma has locale String @default("en"); if your single ' +
  'locale/default locale is not en, update the Prisma default and create a migration ' +
  'with pnpm --filter api db:migrate.'

/**
 * The one Prisma follow-up the Track 10 decision explicitly keeps manual
 * (ai/models-talk.md): trimming SUPPORTED_LOCALES/DEFAULT_LOCALE never
 * touches the database, so a non-`en` locale needs an explicit, stricter
 * nudge toward the real migration step.
 */
export function prismaFollowUpMessage(locale) {
  const prefix =
    locale === 'en'
      ? 'Prisma: no DB default change needed (locale is en).'
      : 'Prisma: required manual follow-up before production use.'
  return `${prefix} ${PRISMA_LOCALE_DEFAULT_NOTE}`
}

export function resolveSharedPaths(root) {
  return {
    sharedConstants: path.join(root, 'packages/shared/src/constants/index.ts'),
    telegramMessages: path.join(
      root,
      'apps/api/src/core/notifications/channels/telegram/telegram-messages.ts'
    ),
    emailMessages: path.join(root, 'apps/api/src/infrastructure/email/messages.ts'),
  }
}

const WEB_SRC = 'apps/web/src'
const LOCALE_APP = `${WEB_SRC}/app/[locale]`
const APP = `${WEB_SRC}/app`

/** Pairs of (old, new) absolute paths for files that move with no content change. */
export function resolvePureMoves(root) {
  const relPaths = [
    '(dashboard)/error.tsx',
    '(dashboard)/layout.tsx',
    '(dashboard)/page.tsx',
    '(dashboard)/settings/sessions/page.tsx',
    'providers.tsx',
  ]
  return relPaths.map((rel) => [path.join(root, LOCALE_APP, rel), path.join(root, APP, rel)])
}

export function resolveDeletions(root) {
  return [
    path.join(root, WEB_SRC, 'proxy.ts'),
    path.join(root, WEB_SRC, 'i18n/routing.ts'),
    path.join(root, WEB_SRC, 'i18n/navigation.ts'),
    path.join(root, WEB_SRC, 'i18n/params.ts'),
    path.join(root, WEB_SRC, 'features/locale-switcher'),
  ]
}
