/**
 * Thrown by `fetchBackend()` for a failure that is deliberately **not** part
 * of the silent-degrade `DataOutcome` vocabulary: a rejected 4xx (a real
 * contract/auth error, not an infra hiccup) or a `2xx` payload that failed
 * the caller's Zod schema. Both must reach a real error boundary /
 * `onRequestError` — never a quiet "no data" — per the FINAL PLAN's
 * `DataOutcome<T>` contract (`ai/models-talk.md` §3).
 *
 * Deliberately carries no field a `catchError` fallback should ever read —
 * see `ai/models-talk.md` §6: a caught RSC error's fields do not reliably
 * survive to the client, and even the parts that do (`message`) must not be
 * shown to a user. `status`/`correlationId` exist for **server-side**
 * logging (`onRequestError`), not for UI presentation.
 */
export class BackendRequestError extends Error {
  constructor(
    public readonly kind: 'rejected' | 'invalid-payload',
    public readonly correlationId: string,
    public readonly status?: number
  ) {
    super(`backend request ${kind} (status=${status ?? 'n/a'}, correlationId=${correlationId})`)
    this.name = 'BackendRequestError'
  }
}
