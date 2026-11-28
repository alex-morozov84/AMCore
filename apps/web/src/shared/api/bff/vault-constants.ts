// Matches the backend refresh-token lifetime (ADR-007) — neither the vault
// entry nor the `amcore_session` cookie should outlive what a fresh login
// would produce. This TTL is a last-resort cleanup bound, not the primary
// revocation mechanism (see ADR-068's bounded-staleness decision for
// backend-session desync).
export const VAULT_TTL_SECONDS = 7 * 24 * 60 * 60
