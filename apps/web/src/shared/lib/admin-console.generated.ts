/**
 * Console topology of this build. Runtime must not read PROJECT_CONTEXT.md.
 */
export type AdminConsoleMode = 'disabled' | 'path' | 'host'

export interface AdminConsoleConfig {
  readonly enabled: boolean
  readonly mode: AdminConsoleMode
  readonly slug: string
}

export const ADMIN_CONSOLE_CONFIG: AdminConsoleConfig = {
  enabled: true,
  mode: 'path',
  slug: 'admin',
} as const
