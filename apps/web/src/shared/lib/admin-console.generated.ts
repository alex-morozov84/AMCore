import { ADMIN_CONSOLE_SETTINGS, type AdminConsoleMode } from '@amcore/shared'

/**
 * Console topology of this build, read from `packages/shared/src/config/admin-console.json`.
 * Runtime must not read PROJECT_CONTEXT.md. The module keeps its name and shape so the
 * Console code that imports it does not change; `slug` is the settings file's `alias`
 * (the public path segment in path mode and the name of the physical page folder).
 */
export type { AdminConsoleMode }

export interface AdminConsoleConfig {
  readonly enabled: boolean
  readonly mode: AdminConsoleMode
  readonly slug: string
}

export const ADMIN_CONSOLE_CONFIG: AdminConsoleConfig = {
  enabled: ADMIN_CONSOLE_SETTINGS.mode !== 'disabled',
  mode: ADMIN_CONSOLE_SETTINGS.mode,
  slug: ADMIN_CONSOLE_SETTINGS.alias,
} as const
