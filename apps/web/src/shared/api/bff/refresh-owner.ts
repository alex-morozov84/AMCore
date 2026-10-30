import type { VerifyBindingOptions } from './browser-binding.server'
import {
  isInvalidRefreshError,
  SessionLockTimeoutError,
  SessionNotFoundError,
  SessionPublicationUnprovenError,
  SessionRefreshUnsafeError,
  SessionVaultUnavailableError,
  UpstreamRotationUnprovenError,
} from './errors'
import { startLockRenewal } from './lock-renewal'
import { hasSessionAudience, type SessionAudience } from './session-audience'
import type {
  UpstreamRefreshFn,
  VaultEntry,
  VaultLock,
  VaultRecord,
  VaultStore,
} from './session-vault.types'

/** Owner budgets. The caller's stage is separate; the owner never inherits an expired caller budget. */
export interface OwnerTiming {
  /** Longest wait for the refresh lock. */
  acquireMs: number
  /** Longest wait for one vault command. */
  opMs: number
  leaseMs: number
  renewEveryMs: number
  /** Ends ordinary pre-commit work; bounded delete and release may continue after it. */
  ceilingMs: number
  /** Attempts of the compare-and-set with its verify-by-read. */
  publishAttempts: number
  /** Attempts of the terminal delete. */
  deleteAttempts: number
}

export const OWNER_TIMING: OwnerTiming = {
  acquireMs: 3000,
  opMs: 1000,
  leaseMs: 10_000,
  renewEveryMs: 4000,
  ceilingMs: 30_000,
  publishAttempts: 3,
  deleteAttempts: 2,
}

/** Longest the binding probe may wait, whatever is left of the owner budget. */
const PROBE_MAX_MS = 10_000
const REFRESH_SAFETY_MARGIN_MS = 30 * 1000

export interface OwnerDeps<TRecord extends VaultRecord> {
  expectedAudience?: SessionAudience
  store: VaultStore<TRecord>
  lock: VaultLock
  upstreamRefresh: UpstreamRefreshFn
  verifyBinding: (entry: TRecord, options?: VerifyBindingOptions) => Promise<void>
  /** Wall clock, for token freshness only. */
  now: () => number
  /** Monotonic clock, for owner durations only (acquisition deadline and ceiling). */
  clock: () => number
  timing: OwnerTiming
}

type Stored<TRecord extends VaultRecord> = TRecord & Pick<VaultEntry, 'version'>
type Step = <T>(dispatch: () => Promise<T>) => Promise<T>

/** Thrown inside the owner when publication cannot be proven; becomes a terminal outcome. */
class PublicationUnknown extends Error {}

/**
 * The single refresh owner of one session in one process (ADR-068 as amended by T082). It runs under
 * its own budgets, independent of the request that started it:
 *
 *   acquire -> re-read -> verify -> upstream refresh -> verify next -> publish (CAS) -> cleanup
 *
 * Every step is a checked dispatch: nothing starts once ordinary work has ended (lease lost or the
 * ceiling reached), the lease/ceiling failure is raced against the step, and a result that arrives
 * after the work ended is not used. `committed` is set only when publication is acknowledged (a CAS
 * that returned true, or a verify-by-read that found this owner's write). If exclusivity or
 * publication cannot be proven AFTER the backend token may have rotated, the owner ends the attempt
 * as terminal and tries a bounded delete; a delete that fails leaves the stored state unknown. A
 * transport error without a response is transient and keeps the session; a success whose reply
 * cannot be used is a rotation that was not published. Only classified Redis outage outcomes are
 * read back and retried; any other error is kept with its cause (cleanup still applies after a
 * rotation). A healthy lease keeps being renewed through the terminal delete; renewal stops only
 * in `finally`.
 */
export async function runRefreshOwner<TRecord extends VaultRecord>(
  sessionId: string,
  deps: OwnerDeps<TRecord>
): Promise<Stored<TRecord>> {
  const { lock, timing, clock } = deps
  const acquiring = clock()
  const token = await lock.acquire(sessionId, timing.leaseMs, { deadlineMs: timing.acquireMs })
  if (token && clock() - acquiring > timing.acquireMs) {
    // A late success belongs to nobody: give the lease back instead of starting owner work.
    await lock.release(sessionId, token).catch(() => undefined)
    throw new SessionLockTimeoutError(sessionId)
  }
  if (!token) throw new SessionLockTimeoutError(sessionId)

  const { renewal, controller, step, probe, readOne, left } = openScope(sessionId, token, deps)

  let committed = false
  let dispatched = false
  let rotated = false
  try {
    const current = await readOne()
    if (!current) throw new SessionNotFoundError('unavailable')
    await step(() => deps.verifyBinding(current, probe()))
    if (current.accessTokenExpiresAt > deps.now() + REFRESH_SAFETY_MARGIN_MS) return current

    // Raced against lease loss: it moves on whether or not the call honors abort.
    const result = await step(() => {
      dispatched = true
      return deps.upstreamRefresh(current.refreshToken, controller.signal, current.browser)
    })
    rotated = true
    const next = { ...current, ...result } as TRecord
    await step(() => deps.verifyBinding(next, probe()))
    return await publish(sessionId, current, next, deps, {
      step,
      readOne,
      probe,
      left,
      // The unpublished rotation is no longer at stake once the vault shows this owner's write or
      // another writer's newer entry: from here a failure must not delete a published session.
      resolved: () => {
        committed = true
      },
    })
  } catch (error) {
    const terminal =
      !committed &&
      // Lease loss or the ceiling before the backend call was sent changed nothing upstream: the
      // session is kept. After the call was sent the rotation cannot be ruled out.
      ((error instanceof SessionRefreshUnsafeError && dispatched) ||
        error instanceof PublicationUnknown ||
        error instanceof UpstreamRotationUnprovenError ||
        isInvalidRefreshError(error) ||
        rotated)
    // Cleanup is independent of how the error is classified; renewal still runs under it.
    if (terminal) await terminalDelete(sessionId, deps)
    if (error instanceof PublicationUnknown) throw new SessionPublicationUnprovenError(error)
    throw error
  } finally {
    renewal.stop()
    // Cleanup: a lost release only leaves the lease to expire and never replaces the outcome.
    await lock.release(sessionId, token).catch(() => undefined)
  }
}

/**
 * The owner's working scope once it holds the lease: renewal from acquisition, the checked
 * dispatch `step`, the binding-probe budget and the audience-checked vault read. Durations use the
 * monotonic clock; the wall clock is only for token freshness.
 */
function openScope<TRecord extends VaultRecord>(
  sessionId: string,
  token: string,
  deps: OwnerDeps<TRecord>
) {
  const { store, lock, timing, clock } = deps
  const startedAt = clock()
  const left = (): number => timing.ceilingMs - (clock() - startedAt)
  const controller = new AbortController()
  const renewal = startLockRenewal(sessionId, token, lock, controller, {
    ttlMs: timing.leaseMs,
    intervalMs: timing.renewEveryMs,
    ceilingMs: timing.ceilingMs,
    now: clock,
  })
  const unsafe = (): SessionRefreshUnsafeError => new SessionRefreshUnsafeError(sessionId)
  const step: Step = async (dispatch) => {
    if (renewal.ended || left() <= 0) throw unsafe()
    const result = await Promise.race([dispatch(), renewal.unsafe])
    if (renewal.ended) throw unsafe()
    return result
  }
  const probe = (): VerifyBindingOptions => ({
    deadlineMs: Math.min(PROBE_MAX_MS, left()),
    signal: controller.signal,
  })
  const readOne = async (): Promise<Stored<TRecord> | null> => {
    const entry = await step(() =>
      store.get(sessionId, { deadlineMs: Math.min(timing.opMs, left()) })
    )
    return entry && (!deps.expectedAudience || hasSessionAudience(entry, deps.expectedAudience))
      ? entry
      : null
  }

  return { renewal, controller, step, probe, readOne, left }
}

/** CAS with verify-by-read. Never replays the upstream refresh. */
async function publish<TRecord extends VaultRecord>(
  sessionId: string,
  current: Stored<TRecord>,
  next: TRecord,
  deps: OwnerDeps<TRecord>,
  steps: {
    step: Step
    readOne: () => Promise<Stored<TRecord> | null>
    probe: () => VerifyBindingOptions
    left: () => number
    resolved: () => void
  }
): Promise<Stored<TRecord>> {
  const { store, timing } = deps
  const { step, readOne, probe, left, resolved } = steps
  for (let attempt = 0; attempt < timing.publishAttempts; attempt++) {
    try {
      const written = await step(() =>
        store.setIfVersionMatches(sessionId, current.version, next, {
          deadlineMs: Math.min(timing.opMs, left()),
        })
      )
      if (written) {
        resolved()
        return { ...next, version: current.version + 1 }
      }
    } catch (error) {
      // Only a classified Redis outage leaves the write's outcome unknown. Lease loss, a bug or a
      // schema error keeps its cause; the owner's catch applies the post-rotation cleanup.
      if (!(error instanceof SessionVaultUnavailableError)) throw error
    }
    let latest: Stored<TRecord> | null
    try {
      latest = await readOne()
    } catch (error) {
      if (!(error instanceof SessionVaultUnavailableError)) throw error
      continue
    }
    if (!latest) throw new SessionNotFoundError(sessionId)
    const ours = latest.refreshToken === next.refreshToken
    if (ours || latest.version !== current.version) {
      resolved()
      // A winner (this owner's own landed write, or another writer's) is returned only after the
      // same mandatory binding verification; a version difference alone proves nothing.
      await step(() => deps.verifyBinding(latest, probe()))
      return latest
    }
  }
  throw new PublicationUnknown('publication outcome unknown')
}

/** Bounded delete while a healthy lease is still renewed. A lost delete leaves the state unknown. */
async function terminalDelete<TRecord extends VaultRecord>(
  sessionId: string,
  deps: OwnerDeps<TRecord>
): Promise<void> {
  for (let attempt = 0; attempt < deps.timing.deleteAttempts; attempt++) {
    try {
      await deps.store.delete(sessionId, { deadlineMs: deps.timing.opMs })
      return
    } catch {
      // try again, then give up: the next request observes whatever the store holds
    }
  }
}
