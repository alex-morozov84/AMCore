import type { VerifyBindingOptions } from './browser-binding.server'
import {
  isInvalidRefreshError,
  SessionLockTimeoutError,
  SessionNotFoundError,
  SessionPublicationUnprovenError,
  SessionRefreshUnsafeError,
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
  /** Ends normal pre-commit work; bounded delete and release may continue after it. */
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
  now: () => number
  timing: OwnerTiming
}

type Stored<TRecord extends VaultRecord> = TRecord & Pick<VaultEntry, 'version'>

/** Thrown inside the owner when publication cannot be proven; becomes a terminal outcome. */
class PublicationUnknown extends Error {}

/**
 * The single refresh owner of one session in one process (ADR-068 as amended by T082). It runs under
 * its own budgets, independent of the request that started it:
 *
 *   acquire -> re-read -> verify -> upstream refresh -> verify next -> publish (CAS) -> cleanup
 *
 * `committed` is set only when publication is acknowledged (a CAS that returned true, or a
 * verify-by-read that found this owner's write). Lease loss or the ceiling is raced against EVERY
 * step before the commit point. If exclusivity or publication cannot be proven AFTER the backend
 * token may have rotated, the owner ends the attempt as terminal and tries a bounded delete; a
 * delete that fails leaves the stored state unknown (a later request may continue from a fresh
 * publication, find no session, or be rejected by the backend). A transport error without a
 * response is transient and keeps the session. Renewal and the ceiling run through the terminal
 * delete and stop only in `finally`, so no renewal callback acts after cleanup.
 */
export async function runRefreshOwner<TRecord extends VaultRecord>(
  sessionId: string,
  deps: OwnerDeps<TRecord>
): Promise<Stored<TRecord>> {
  const { store, lock, timing } = deps
  const token = await lock.acquire(sessionId, timing.leaseMs, { deadlineMs: timing.acquireMs })
  if (!token) throw new SessionLockTimeoutError(sessionId)

  const startedAt = deps.now()
  const left = (): number => Math.max(1, timing.ceilingMs - (deps.now() - startedAt))
  const controller = new AbortController()
  const renewal = startLockRenewal(sessionId, token, lock, controller, {
    ttlMs: timing.leaseMs,
    intervalMs: timing.renewEveryMs,
    ceilingMs: timing.ceilingMs,
  })
  const guard = <T>(step: Promise<T>): Promise<T> => Promise.race([step, renewal.unsafe])
  const probe = (): VerifyBindingOptions => ({
    deadlineMs: Math.min(PROBE_MAX_MS, left()),
    signal: controller.signal,
  })
  const readOne = async (): Promise<Stored<TRecord> | null> => {
    const entry = await guard(store.get(sessionId, { deadlineMs: timing.opMs }))
    return entry && (!deps.expectedAudience || hasSessionAudience(entry, deps.expectedAudience))
      ? entry
      : null
  }

  let committed = false
  let rotated = false
  try {
    const current = await readOne()
    if (!current) throw new SessionNotFoundError('unavailable')
    await guard(deps.verifyBinding(current, probe()))
    if (current.accessTokenExpiresAt > deps.now() + REFRESH_SAFETY_MARGIN_MS) return current

    // Race the upstream refresh against lease loss: it moves on whether or not the call honors abort.
    const result = await guard(
      deps.upstreamRefresh(current.refreshToken, controller.signal, current.browser)
    )
    rotated = true
    const next = { ...current, ...result } as TRecord
    await guard(deps.verifyBinding(next, probe()))
    return await publish(sessionId, current, next, deps, {
      guard,
      readOne,
      probe,
      // The unpublished rotation is no longer at stake once the vault shows this owner's write or
      // another writer's newer entry: from here a failure must not delete a published session.
      resolved: () => {
        committed = true
      },
    })
  } catch (error) {
    const terminal =
      !committed &&
      (error instanceof SessionRefreshUnsafeError ||
        error instanceof PublicationUnknown ||
        isInvalidRefreshError(error) ||
        rotated)
    if (terminal) await terminalDelete(sessionId, deps)
    if (error instanceof PublicationUnknown) throw new SessionPublicationUnprovenError(error)
    throw error
  } finally {
    renewal.stop()
    // Cleanup: a lost release only leaves the lease to expire and never replaces the outcome.
    await lock.release(sessionId, token).catch(() => undefined)
  }
}

/** CAS with verify-by-read. Never replays the upstream refresh. */
async function publish<TRecord extends VaultRecord>(
  sessionId: string,
  current: Stored<TRecord>,
  next: TRecord,
  deps: OwnerDeps<TRecord>,
  steps: {
    guard: <T>(step: Promise<T>) => Promise<T>
    readOne: () => Promise<Stored<TRecord> | null>
    probe: () => VerifyBindingOptions
    resolved: () => void
  }
): Promise<Stored<TRecord>> {
  const { store, timing } = deps
  const { guard, readOne, probe, resolved } = steps
  for (let attempt = 0; attempt < timing.publishAttempts; attempt++) {
    try {
      const written = await guard(
        store.setIfVersionMatches(sessionId, current.version, next, { deadlineMs: timing.opMs })
      )
      if (written) {
        resolved()
        return { ...next, version: current.version + 1 }
      }
    } catch (error) {
      if (error instanceof SessionRefreshUnsafeError) throw error
      // Unknown outcome of the write: fall through to the read that decides it.
    }
    let latest: Stored<TRecord> | null
    try {
      latest = await readOne()
    } catch (error) {
      if (error instanceof SessionRefreshUnsafeError) throw error
      continue
    }
    if (!latest) throw new SessionNotFoundError(sessionId)
    const ours = latest.refreshToken === next.refreshToken
    if (ours || latest.version !== current.version) {
      resolved()
      // A winner (this owner's own landed write, or another writer's) is returned only after the
      // same mandatory binding verification; a version difference alone proves nothing.
      await guard(deps.verifyBinding(latest, probe()))
      return latest
    }
  }
  throw new PublicationUnknown('publication outcome unknown')
}

/** Bounded delete while renewal still runs. A lost delete leaves the stored state unknown. */
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
