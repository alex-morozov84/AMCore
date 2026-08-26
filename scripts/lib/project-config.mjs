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
