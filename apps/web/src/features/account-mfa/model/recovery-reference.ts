import { z } from 'zod'

import 'client-only'

const schema = z
  .object({
    flowBinding: z.string().uuid().optional(),
    operationId: z.string().uuid().optional(),
    startPurpose: z.enum(['rotate_codes', 'replace_factor']).optional(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
export type MfaRecoveryReference = z.infer<typeof schema>
const prefix = 'amcore:mfa-reference:v1:'

/** Untrusted, tab-local routing hints only. All capabilities remain server-side. */
export function readMfaReference(scope: string): MfaRecoveryReference | undefined {
  try {
    const value = schema.safeParse(JSON.parse(sessionStorage.getItem(prefix + scope) ?? 'null'))
    if (value.success && value.data.expiresAt > Date.now()) return value.data
    sessionStorage.removeItem(prefix + scope)
  } catch {
    /* Unavailable browser storage must not confer or block authority. */
  }
  return undefined
}
export function writeMfaReference(scope: string, reference?: MfaRecoveryReference) {
  try {
    if (reference) sessionStorage.setItem(prefix + scope, JSON.stringify(schema.parse(reference)))
    else sessionStorage.removeItem(prefix + scope)
  } catch {
    /* The UI remains usable; reload recovery is not promised without this hint. */
  }
}
