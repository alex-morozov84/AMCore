// Path/mode tables for init:project, mirroring brand-config.mjs's role for
// init:brand.
import path from 'node:path'

/** `multi` is the implicit starting state; `single` is the only automated
 * destination for v1 (ADR-071) — adding a locale stays a manual recipe. */
export const PROJECT_MODES = ['single']

export function resolveSharedPaths(root) {
  return {
    sharedConstants: path.join(root, 'packages/shared/src/constants/index.ts'),
    telegramMessages: path.join(
      root,
      'apps/api/src/core/notifications/channels/telegram/telegram-messages.ts'
    ),
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
