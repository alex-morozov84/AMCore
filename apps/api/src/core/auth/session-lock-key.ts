/**
 * Shared advisory-lock namespace for session-state coordination.
 *
 * Used by BOTH `SessionService.rotateRefreshToken` (this module) and
 * `AdminSessionsService.revokeOne`/`revokeAll` (`core/admin`) so a refresh
 * rotation and an admin revoke on the same user's sessions always serialize
 * through the identical Postgres advisory lock key, even though those two
 * services deliberately do not depend on each other (importing `AuthModule`
 * into `AdminModule` would be cycle-heavy — see `admin.service.ts`'s
 * `revokeTargetSessions`). A plain pure function has no module-graph cost,
 * so both sides can share it without that import.
 */
export function sessionCoordinationLockKey(userId: string): string {
  return `session-coordination:${userId}`
}
