import { Injectable } from '@nestjs/common'
import { AiProviderType } from '@prisma/client'

import type { Env } from '../../../env'

import { EnvService } from '@/env/env.service'

/**
 * Code-owned credential allowlist (Track C — ADR-054, Arc B).
 *
 * A catalog row carries a logical `credentialSlot` (a bounded identifier), never a raw env
 * name. This table is the ONLY place a slot is turned into a concrete secret: per provider
 * `type`, each allowed slot maps to one FIXED env key. A DB value therefore never indexes
 * `process.env` directly, so a hostile or misconfigured catalog row cannot reference an
 * unrelated secret (e.g. `JWT_SECRET`). An unknown type or slot fails closed (no credential).
 * `MOCK` needs no credential — its slot map is intentionally empty.
 */
const AI_CREDENTIAL_ALLOWLIST = {
  [AiProviderType.ANTHROPIC]: { default: 'ANTHROPIC_API_KEY' },
  [AiProviderType.OPENAI]: { default: 'OPENAI_API_KEY' },
  [AiProviderType.OPENROUTER]: { default: 'OPENROUTER_API_KEY' },
  [AiProviderType.OPENAI_COMPATIBLE]: { default: 'AI_OPENAI_COMPATIBLE_API_KEY' },
  [AiProviderType.YANDEX_AI_STUDIO]: { default: 'YANDEX_API_KEY' },
  [AiProviderType.MOCK]: {},
} as const satisfies Record<AiProviderType, Record<string, keyof Env>>

/**
 * Resolves a catalog credential slot to its concrete secret through the allowlist above.
 * The resolved secret value is returned only to the adapter that performs the provider call;
 * it is never logged and never surfaced in an error or response.
 */
@Injectable()
export class AiCredentialResolver {
  constructor(private readonly env: EnvService) {}

  /** Whether a provider type needs a credential at all (`MOCK` does not). */
  requiresCredential(type: AiProviderType): boolean {
    return Object.keys(AI_CREDENTIAL_ALLOWLIST[type]).length > 0
  }

  /** The fixed env key for a (type, slot), or `null` if the slot is not allowlisted. */
  resolveEnvKey(type: AiProviderType, slot: string | null): keyof Env | null {
    if (slot === null) return null
    const slots: Record<string, keyof Env> = AI_CREDENTIAL_ALLOWLIST[type]
    return Object.prototype.hasOwnProperty.call(slots, slot) ? slots[slot]! : null
  }

  /** The resolved secret value, or `null` when absent/unallowlisted. Adapter-only. */
  getCredential(type: AiProviderType, slot: string | null): string | null {
    const envKey = this.resolveEnvKey(type, slot)
    if (envKey === null) return null
    const value = this.env.get(envKey)
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  /**
   * Whether a usable credential is available — the gate the registry uses before treating an
   * enabled provider as selectable. Credential-less providers (`MOCK`) are always available.
   */
  hasCredential(type: AiProviderType, slot: string | null): boolean {
    if (!this.requiresCredential(type)) return true
    return this.getCredential(type, slot) !== null
  }
}
