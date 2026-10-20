import type { VaultRecord } from './session-vault.types'

export type SessionAudience = NonNullable<VaultRecord['audience']>

export function hasSessionAudience(entry: VaultRecord, expected: SessionAudience): boolean {
  return entry.audience === expected || (expected === 'product' && entry.audience === undefined)
}
