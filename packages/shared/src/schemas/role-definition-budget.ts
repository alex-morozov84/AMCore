/**
 * Byte and count budgets for the role-definition contracts.
 *
 * Every BFF cap is the cap; the matching API cap reserves `ROLE_ENVELOPE_RESERVE_BYTES`
 * for the `{binding, data}` envelope the web BFF adds, so an API success at its own
 * boundary is never rejected by the BFF (same reserve pattern as the member budgets).
 */
export const ROLE_ENVELOPE_RESERVE_BYTES = 1024

export const ROLE_LIST_RESPONSE_BYTES = 262_144
export const ROLE_LIST_API_RESPONSE_BYTES = ROLE_LIST_RESPONSE_BYTES - ROLE_ENVELOPE_RESERVE_BYTES
export const ROLE_DETAIL_RESPONSE_BYTES = 786_432
export const ROLE_DETAIL_API_RESPONSE_BYTES =
  ROLE_DETAIL_RESPONSE_BYTES - ROLE_ENVELOPE_RESERVE_BYTES

/** Decoded request-body ceiling for create / save / delete commands. */
export const ROLE_REQUEST_BYTES = 16_384

/** A role with more stored rules, or more serialized rule bytes, is read-only (`oversized`). */
export const ROLE_EDITABLE_RULE_LIMIT = 200
export const ROLE_RULE_BYTES_LIMIT = 262_144

/** Per-page budget for classifying rules in the list (rows / loaded JSON bytes). */
export const ROLE_LIST_CLASSIFY_ROWS = 2000
export const ROLE_LIST_CLASSIFY_BYTES = 524_288

export const ROLE_HOLDER_SAMPLE_LIMIT = 10
export const ROLE_PRESET_SELECTION_LIMIT = 64
export const ROLE_MANAGED_PERMISSION_IDS_LIMIT = 16
/** `(page - 1) * limit` ceiling for the role list. */
export const ROLE_LIST_MAX_OFFSET = 100_000
