import { ADMIN_CONSOLE_SETTINGS, type AdminConsoleMode } from '@amcore/shared'

/** Console topology of this build, read from the shared build settings. */
export type { AdminConsoleMode }

export interface AdminConsoleConfig {
  readonly enabled: boolean
  readonly mode: AdminConsoleMode
  readonly alias: string
}

export const ADMIN_CONSOLE_CONFIG: AdminConsoleConfig = {
  enabled: ADMIN_CONSOLE_SETTINGS.mode !== 'disabled',
  mode: ADMIN_CONSOLE_SETTINGS.mode,
  alias: ADMIN_CONSOLE_SETTINGS.alias,
} as const
