/**
 * Budgets for the member effective-access explanation.
 *
 * The BFF cap is the cap; the API reserves `ROLE_ENVELOPE_RESERVE_BYTES` for the `{binding, data}`
 * envelope, the same pattern as the role and member budgets. Loading limits fail the whole request
 * (`ROLE_ACCESS_UNAVAILABLE`) rather than answering from a partial policy.
 */
import { ROLE_ENVELOPE_RESERVE_BYTES } from './role-definition-budget'

export const ACCESS_RESPONSE_BYTES = 524_288
export const ACCESS_API_RESPONSE_BYTES = ACCESS_RESPONSE_BYTES - ROLE_ENVELOPE_RESERVE_BYTES

/** What the server may load to answer: roles of the member, role-permission links, distinct rules, bytes. */
export const ACCESS_MAX_ROLES = 1000
export const ACCESS_MAX_LINKS = 5000
export const ACCESS_MAX_UNIQUE_RULES = 2000
export const ACCESS_MAX_POLICY_BYTES = 1_048_576

/** Single-role counterfactuals (who alone would grant, who widens) are extra work with their own cap. */
export const ACCESS_COUNTERFACTUAL_MAX_ROLES = 25
export const ACCESS_COUNTERFACTUAL_MAX_RULES = 500

/** Bounded lists in the response, always with a total or a truncated flag. */
export const ACCESS_ROLES_SHOWN = 50
export const ACCESS_ROLE_REFS_LIMIT = 5
export const ACCESS_SOURCES_PER_ITEM = 10
export const ACCESS_UNCOVERED_ROLE_SAMPLE = 10

/**
 * Capabilities a product registers are explained without a record (areas the role settings
 * configure). The catalogue size therefore bounds both the response and the work, and is checked
 * before anything is loaded.
 */
export const ACCESS_MAX_ITEMS = 600
/** Editable fields of one capability that a limit or an area may list. */
export const ACCESS_FIELDS_MAX = 32
/** A configured item names at most one area per kind and one limit per cause. */
export const ACCESS_AREAS_MAX = 4
export const ACCESS_LIMITS_MAX = 4
/** Displayed rule sources of a configured item; the calculation always uses every rule first. */
export const ACCESS_CONFIGURED_SOURCES_PER_ITEM = 4
/** Units of internal checks one request may spend; exceeding it fails the whole request. */
export const ACCESS_MAX_OPERATIONS = 3_000_000
