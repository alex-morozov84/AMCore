import type { VerifyBindingOptions } from './browser-binding.server'
import { SessionNotFoundError, SessionStageTimeoutError } from './errors'
import { OWNER_TIMING, type OwnerTiming, runRefreshOwner } from './refresh-owner'
import { hasSessionAudience, type SessionAudience } from './session-audience'
import type {
  UpstreamRefreshFn,
  VaultEntry,
  VaultLock,
  VaultRecord,
  VaultStore,
} from './session-vault.types'

import 'server-only'

/** Refresh proactively before the access token actually expires. */
const REFRESH_SAFETY_MARGIN_MS = 30 * 1000
/** The caller never waits longer than this for admission, including a refresh already running. */
export const CALLER_STAGE_MS = 3000
/** The binding probe never waits longer than this, even with plenty of the stage left. */
const PROBE_MAX_MS = 10_000

export interface EnsureFreshSessionDeps<TRecord extends VaultRecord = VaultRecord> {
  expectedAudience?: SessionAudience
  store: VaultStore<TRecord>
  lock: VaultLock
  upstreamRefresh: UpstreamRefreshFn
  verifyBinding: (entry: TRecord, options?: VerifyBindingOptions) => Promise<void>
  /** Wall clock, for token freshness only. */
  now?: () => number
  /** Test overrides: the caller stage, the owner budgets and the monotonic clock. */
  timing?: { stageMs?: number; owner?: Partial<OwnerTiming>; clock?: () => number }
}

function isFresh(entry: VaultEntry, now: number): boolean {
  return entry.accessTokenExpiresAt > now + REFRESH_SAFETY_MARGIN_MS
}

/**
 * One refresh owner per session per lock namespace per process. The lock object is the namespace:
 * in production it is a process-wide singleton per audience, so concurrent callers share one owner;
 * another process (or a test standing in for one) has its own object and contends for the lock.
 */
const owners = new WeakMap<object, Map<string, Promise<unknown>>>()
let activeOwners = 0

/** Test-only visibility: owners still running in this process (must reach 0 once they finish). */
export function activeRefreshOwners(): number {
  return activeOwners
}

/**
 * Returns a `VaultEntry` with a currently-valid access token for `sessionId`, refreshing it via
 * the single-flight protocol from ADR-068 if needed.
 *
 * The CALLER and the refresh OWNER are separate (T082). The caller has one absolute budget of
 * `CALLER_STAGE_MS` for its vault read, its binding check and, if a refresh is needed, for the
 * owner. Every step is a checked dispatch: nothing starts after the budget is spent, and a step
 * that finishes after it is not accepted, so admission never succeeds late. The caller then leaves
 * with `SessionStageTimeoutError` (a temporary failure) and the session is untouched by that
 * departure; the owner continues under its own budgets (see `refresh-owner.ts`). Throws
 * `SessionNotFoundError` if there is no session, `SessionVaultUnavailableError` when the vault
 * store cannot be reached ("cannot authenticate", never "no session"), `SessionRefreshUnsafeError`
 * when exclusivity or the ceiling was lost after the backend call was sent, or rethrows whatever
 * `upstreamRefresh`/`verifyBinding` threw. The vault entry is deleted only on an explicit
 * invalid/reuse rejection or when a rotation could not be proven or published.
 */
export async function ensureFreshSession<TRecord extends VaultRecord = VaultRecord>(
  sessionId: string,
  deps: EnsureFreshSessionDeps<TRecord>
): Promise<TRecord & Pick<VaultEntry, 'version'>> {
  const now = deps.now ?? Date.now
  const clock = deps.timing?.clock ?? (() => performance.now())
  const stageMs = deps.timing?.stageMs ?? CALLER_STAGE_MS
  const started = clock()
  const left = (): number => stageMs - (clock() - started)
  const stage = new AbortController()
  let spent = false

  const spend = (step: string): never => {
    spent = true
    stage.abort()
    throw new SessionStageTimeoutError(step)
  }
  /** Checked dispatch: refuse before starting, race the deadline, refuse a late result. */
  const within = async <T>(step: string, dispatch: () => Promise<T>): Promise<T> => {
    if (spent || left() <= 0) spend(step)
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          spent = true
          stage.abort()
          reject(new SessionStageTimeoutError(step))
        },
        Math.max(0, left())
      )
    })
    try {
      const result = await Promise.race([dispatch(), deadline])
      if (spent || left() <= 0) spend(step)
      return result
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const entry = await within('vault read', () =>
      deps.store.get(sessionId, { deadlineMs: left() })
    )
    if (!entry || (deps.expectedAudience && !hasSessionAudience(entry, deps.expectedAudience)))
      throw new SessionNotFoundError('unavailable')
    await within('binding check', () =>
      deps.verifyBinding(entry, {
        deadlineMs: Math.min(PROBE_MAX_MS, left()),
        signal: stage.signal,
      })
    )
    if (isFresh(entry, now())) return entry

    return await within('refresh owner', () => joinOwner(sessionId, deps, now, clock))
  } finally {
    // Releases a still-running caller-side probe; the owner has its own controller.
    stage.abort()
  }
}

function joinOwner<TRecord extends VaultRecord>(
  sessionId: string,
  deps: EnsureFreshSessionDeps<TRecord>,
  now: () => number,
  clock: () => number
): Promise<TRecord & Pick<VaultEntry, 'version'>> {
  const registry = owners.get(deps.lock) ?? new Map<string, Promise<unknown>>()
  owners.set(deps.lock, registry)
  const existing = registry.get(sessionId)
  if (existing) return existing as Promise<TRecord & Pick<VaultEntry, 'version'>>
  const owner = runRefreshOwner(sessionId, {
    expectedAudience: deps.expectedAudience,
    store: deps.store,
    lock: deps.lock,
    upstreamRefresh: deps.upstreamRefresh,
    verifyBinding: deps.verifyBinding,
    now,
    clock,
    timing: { ...OWNER_TIMING, ...deps.timing?.owner },
  })
  registry.set(sessionId, owner)
  activeOwners++
  const remove = (): void => {
    activeOwners--
    if (registry.get(sessionId) === owner) registry.delete(sessionId)
  }
  // A departed caller must not leave the owner's failure unobserved.
  owner.then(remove, remove)
  return owner
}
