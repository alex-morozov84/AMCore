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
  now?: () => number
  /** Test overrides of the caller stage and the owner budgets. */
  timing?: { stageMs?: number; owner?: Partial<OwnerTiming> }
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
 * The CALLER and the refresh OWNER are separate (T082). The caller waits at most `CALLER_STAGE_MS`
 * for its vault read, its binding check and, if a refresh is needed, for the owner; it then leaves
 * with `SessionStageTimeoutError` (a temporary failure) and the session is untouched by that
 * departure. The owner continues under its own budgets (see `refresh-owner.ts`). Throws
 * `SessionNotFoundError` if there is no session, `SessionVaultUnavailableError` when the vault
 * store cannot be reached ("cannot authenticate", never "no session"), `SessionRefreshUnsafeError`
 * when exclusivity or the ceiling was lost before publication, or rethrows whatever
 * `upstreamRefresh`/`verifyBinding` threw. The vault entry is deleted only on an explicit
 * invalid/reuse rejection or when a rotation could not be proven or published.
 */
export async function ensureFreshSession<TRecord extends VaultRecord = VaultRecord>(
  sessionId: string,
  deps: EnsureFreshSessionDeps<TRecord>
): Promise<TRecord & Pick<VaultEntry, 'version'>> {
  const now = deps.now ?? Date.now
  const stageMs = deps.timing?.stageMs ?? CALLER_STAGE_MS
  const started = performance.now()
  const left = (): number => Math.max(1, stageMs - (performance.now() - started))
  const stage = new AbortController()

  const within = <T>(step: string, work: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        stage.abort()
        reject(new SessionStageTimeoutError(step))
      }, left())
      work.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        }
      )
    })

  try {
    const entry = await within('vault read', deps.store.get(sessionId, { deadlineMs: left() }))
    if (!entry || (deps.expectedAudience && !hasSessionAudience(entry, deps.expectedAudience)))
      throw new SessionNotFoundError('unavailable')
    await within(
      'binding check',
      deps.verifyBinding(entry, {
        deadlineMs: Math.min(PROBE_MAX_MS, left()),
        signal: stage.signal,
      })
    )
    if (isFresh(entry, now())) return entry

    return await within('refresh owner', joinOwner(sessionId, deps, now))
  } finally {
    // Releases a still-running caller-side probe; the owner has its own controller.
    stage.abort()
  }
}

function joinOwner<TRecord extends VaultRecord>(
  sessionId: string,
  deps: EnsureFreshSessionDeps<TRecord>,
  now: () => number
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
