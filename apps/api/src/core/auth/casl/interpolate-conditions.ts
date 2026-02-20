import type { RequestPrincipal } from '@amcore/shared'

/**
 * Interpolate template strings in CASL conditions
 *
 * Replaces placeholders like "${user.sub}" with actual values from the principal.
 *
 * Example:
 * ```typescript
 * const conditions = { assignedToId: "${user.sub}" }
 * const principal = { sub: "user_123", ... }
 * const result = interpolateConditions(conditions, principal)
 * // → { assignedToId: "user_123" }
 * ```
 *
 * Supported paths: "user.sub", "user.organizationId", etc.
 *
 * @param conditions - CASL conditions object with template strings
 * @param principal - RequestPrincipal (user identity)
 * @returns Conditions with interpolated values
 */
export function interpolateConditions(
  conditions: Record<string, unknown>,
  principal: RequestPrincipal
): Record<string, unknown> {
  // Convert to JSON string, replace all ${...} templates, parse back
  return JSON.parse(
    JSON.stringify(conditions).replace(/"\$\{([^}]+)\}"/g, (_, path: string) => {
      // Simple dot-path resolver: "user.sub" → principal.sub
      const value = getNestedValue({ user: principal }, path)
      return JSON.stringify(value)
    })
  )
}

/**
 * Get nested value from object by dot-path
 *
 * @param obj - Object to access
 * @param path - Dot-separated path (e.g., "user.sub")
 * @returns Value at path or undefined
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}
