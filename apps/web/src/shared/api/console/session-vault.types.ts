import type { VaultEntry, VaultRecord } from '@/shared/api/bff/session-vault.types'

export const CONSOLE_AUDIENCE = 'console'

export interface ConsoleVaultRecord extends VaultRecord {
  audience: typeof CONSOLE_AUDIENCE
}

export type ConsoleVaultEntry = ConsoleVaultRecord & Pick<VaultEntry, 'version'>
