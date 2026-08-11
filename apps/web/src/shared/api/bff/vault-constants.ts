// Matches the backend refresh-token lifetime (ADR-007) — neither the vault
// entry nor the `amcore_session` cookie should outlive what a fresh login
// would produce. This TTL is a last-resort cleanup bound, not the primary
// revocation mechanism (see ADR-068's bounded-staleness decision for
// backend-session desync).
export const VAULT_TTL_SECONDS = 7 * 24 * 60 * 60

// Backend access tokens are 15 minutes (ADR-007). The backend's AuthResponse
// only returns the token string, not its expiry, so this is computed from
// receipt time rather than decoded from the JWT — simpler than adding a JWT
// library, and `ensureFreshSession`'s own refresh safety margin already
// tolerates minor clock skew between Next and the issuing backend.
export const ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1000
