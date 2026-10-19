import type { CapabilityDescriptor } from '../constants/capability-catalogue'
import { apiKeyScopeSchema } from '../schemas/api-keys'

export interface ApiKeyScopeOption {
  primaryScope: string
  scopes: string[]
  capabilities: CapabilityDescriptor[]
}

/** Validate every declaration, including excluded operations. No dependency graph is traversed. */
export function apiKeyScopeOptions(
  catalogue: readonly CapabilityDescriptor[]
): ApiKeyScopeOption[] {
  const groups = new Map<string, ApiKeyScopeOption>()
  for (const entry of catalogue) {
    const additions = entry.additionalApiKeyScopes === undefined ? [] : entry.additionalApiKeyScopes
    if (!Array.isArray(additions) || (!entry.credentials.includes('apiKey') && additions.length))
      throw new Error('Invalid API-key scope metadata')
    for (const scope of additions) apiKeyScopeSchema.parse(scope)
    if (!entry.credentials.includes('apiKey')) continue
    const primaryScope = apiKeyScopeSchema.parse(`${entry.action}:${entry.subject}`)
    const group = groups.get(primaryScope) ?? { primaryScope, scopes: [], capabilities: [] }
    group.scopes = [...new Set([...group.scopes, primaryScope, ...additions])].sort()
    group.capabilities.push(entry)
    groups.set(primaryScope, group)
  }
  return [...groups.values()].sort((a, b) =>
    a.primaryScope < b.primaryScope ? -1 : a.primaryScope > b.primaryScope ? 1 : 0
  )
}

export function selectedApiKeyScopes(
  options: readonly ApiKeyScopeOption[],
  selected: readonly string[]
): string[] {
  return [
    ...new Set(
      options
        .filter((option) => selected.includes(option.primaryScope))
        .flatMap((option) => option.scopes)
    ),
  ].sort()
}
