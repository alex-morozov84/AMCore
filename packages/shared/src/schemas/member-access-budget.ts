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
