// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextRequestError } from './context-errors'
import { activeRefreshOwners, ensureFreshSession } from './ensure-fresh-session'
import {
  SessionLockTimeoutError,
  SessionNotFoundError,
  SessionPublicationUnprovenError,
  SessionRefreshUnsafeError,
  SessionStageTimeoutError,
  SessionVaultUnavailableError,
  UpstreamRotationUnprovenError,
} from './errors'
import type { UpstreamRefreshFn, VaultEntry, VaultLock } from './session-vault.types'
import { FakeVaultStore, freshRefresh, makeEntry } from './test-fakes'
import { FailingRenewalLock, SimpleLock } from './test-lock-fakes'

// The refresh owner under fake time: every case asserts the vault, the backend call count, the
// lock and the owner registry, not just the thrown error.
vi.mock('server-only', () => ({}))

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Fake store whose compare-and-set and delete can be held or failed from the test. */
class ControlledStore extends FakeVaultStore {
  casGate: Promise<void> | null = null
  casFails: 'throw' | 'false' | null = null
  /** When true the write lands in the store even though the caller sees a failure. */
  casLandsAnyway = false
  deletes = 0
  deleteFails = false
  deleteGate: Promise<void> | null = null
  casThrows: Error | null = null
  override async setIfVersionMatches(
    sessionId: string,
    expectedVersion: number,
    entry: Omit<VaultEntry, 'version'>
  ): Promise<boolean> {
    if (this.casGate) await this.casGate
    if (this.casThrows) throw this.casThrows
    if (this.casFails) {
      if (this.casLandsAnyway) await super.setIfVersionMatches(sessionId, expectedVersion, entry)
      if (this.casFails === 'throw') throw new SessionVaultUnavailableError(new Error('reply lost'))
      return false
    }
    return super.setIfVersionMatches(sessionId, expectedVersion, entry)
  }
  override async delete(sessionId: string): Promise<void> {
    this.deletes++
    if (this.deleteGate) await this.deleteGate
    if (this.deleteFails) throw new Error('delete lost')
    await super.delete(sessionId)
  }
}

class TrackingLock extends SimpleLock {
  released = 0
  override async release(): Promise<void> {
    this.released++
  }
}

const expired = () => makeEntry({ accessTokenExpiresAt: Date.now() - 1000 })
const changed = () => new ContextRequestError(401, 'AUTH_CONTEXT_CHANGED')

describe('refresh owner', () => {
  let store: ControlledStore
  beforeEach(() => {
    vi.useFakeTimers()
    store = new ControlledStore()
    store.seed('s1', expired())
  })
  afterEach(() => vi.useRealTimers())

  const call = (overrides: Record<string, unknown> = {}) =>
    ensureFreshSession('s1', {
      store,
      lock: new TrackingLock(),
      verifyBinding: async () => undefined,
      upstreamRefresh: vi.fn(freshRefresh),
      timing: { stageMs: 60_000 },
      ...overrides,
    } as never)

  describe('caller and owner are separate', () => {
    it('lets the caller leave at its stage while the owner finishes and publishes', async () => {
      const upstream = deferred<Awaited<ReturnType<UpstreamRefreshFn>>>()
      const upstreamRefresh = vi.fn(() => upstream.promise)
      const caller = call({ upstreamRefresh, timing: { stageMs: 3000 } }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(3100)
      await expect(caller).resolves.toBeInstanceOf(SessionStageTimeoutError)
      // The owner is still running and holds the only backend call.
      expect(activeRefreshOwners()).toBe(1)
      upstream.resolve({
        accessToken: 'at-2',
        accessTokenExpiresAt: Date.now() + 60_000,
        refreshToken: 'rt-2',
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(activeRefreshOwners()).toBe(0)
      expect(upstreamRefresh).toHaveBeenCalledTimes(1)
      await expect(store.get('s1')).resolves.toMatchObject({ refreshToken: 'rt-2', version: 2 })
      // The next request serves the published entry without another backend call.
      await expect(call({ upstreamRefresh })).resolves.toMatchObject({ refreshToken: 'rt-2' })
      expect(upstreamRefresh).toHaveBeenCalledTimes(1)
    })

    it('leaves no unobserved rejection when the owner fails after the caller left', async () => {
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown): number => unhandled.push(reason)
      process.on('unhandledRejection', onUnhandled)
      const upstream = deferred<never>()
      const caller = call({
        upstreamRefresh: vi.fn(() => upstream.promise),
        timing: { stageMs: 3000 },
      }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(3100)
      await caller
      upstream.reject(Object.assign(new Error('rejected'), { code: 'invalid' }))
      vi.useRealTimers()
      await new Promise((resolve) => setImmediate(resolve))
      process.off('unhandledRejection', onUnhandled)
      expect(unhandled).toEqual([])
      expect(activeRefreshOwners()).toBe(0)
      await expect(store.get('s1')).resolves.toBeNull()
    })

    it('shares one owner and one backend call between concurrent callers in a process', async () => {
      const lock = new TrackingLock()
      const upstreamRefresh = vi.fn(freshRefresh)
      const results = await Promise.all([
        call({ lock, upstreamRefresh }),
        call({ lock, upstreamRefresh }),
        call({ lock, upstreamRefresh }),
      ])
      expect(upstreamRefresh).toHaveBeenCalledTimes(1)
      expect(new Set(results.map((r) => r.refreshToken))).toEqual(new Set(['rt-2']))
    })
  })

  describe('lock lifecycle', () => {
    it('does not acquire past its own deadline: SessionLockTimeoutError, vault untouched', async () => {
      const lock: VaultLock = {
        acquire: async () => null,
        renew: async () => true,
        release: async () => undefined,
      }
      await expect(call({ lock })).rejects.toBeInstanceOf(SessionLockTimeoutError)
      await expect(store.get('s1')).resolves.not.toBeNull()
    })

    it('releases the lock after success', async () => {
      const lock = new TrackingLock()
      await call({ lock })
      expect(lock.released).toBe(1)
    })

    it('a failing release never replaces the result', async () => {
      const lock: VaultLock = {
        acquire: async () => 'tok',
        renew: async () => true,
        release: async () => {
          throw new Error('release lost')
        },
      }
      await expect(call({ lock })).resolves.toMatchObject({ refreshToken: 'rt-2' })
    })
  })

  describe('lease loss and ceiling before the commit point', () => {
    it('lease lost while the compare-and-set is held: terminal delete, no success, late write cannot resurrect', async () => {
      const gate = deferred<void>()
      store.casGate = gate.promise
      const result = call({ lock: new FailingRenewalLock() }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(4_100)
      await expect(result).resolves.toBeInstanceOf(SessionRefreshUnsafeError)
      await expect(store.get('s1')).resolves.toBeNull()
      // The held compare-and-set lands after the delete: the key stays absent.
      gate.resolve()
      await vi.advanceTimersByTimeAsync(0)
      await expect(store.get('s1')).resolves.toBeNull()
      expect(activeRefreshOwners()).toBe(0)
    })

    it('ceiling reached during publication: terminal, no success', async () => {
      const gate = deferred<void>()
      store.casGate = gate.promise
      const result = call({ timing: { stageMs: 60_000, owner: { ceilingMs: 2500 } } }).catch(
        (e: unknown) => e
      )
      await vi.advanceTimersByTimeAsync(2_600)
      await expect(result).resolves.toBeInstanceOf(SessionRefreshUnsafeError)
      await expect(store.get('s1')).resolves.toBeNull()
      gate.resolve()
    })

    it('a lost terminal delete leaves the stored state unknown and is bounded', async () => {
      store.deleteFails = true
      store.casGate = new Promise(() => undefined)
      const result = call({
        lock: new FailingRenewalLock(),
        timing: { stageMs: 60_000, owner: { ceilingMs: 30_000 } },
      }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(4_100)
      await expect(result).resolves.toBeInstanceOf(SessionRefreshUnsafeError)
      expect(store.deletes).toBe(2)
    })
  })

  describe('binding checks around the rotation', () => {
    it('pre-rotation refusal keeps the session and sends nothing upstream', async () => {
      const upstreamRefresh = vi.fn(freshRefresh)
      const verifyBinding = vi
        .fn()
        .mockRejectedValue(new ContextRequestError(503, 'SERVICE_UNAVAILABLE'))
      await expect(call({ upstreamRefresh, verifyBinding })).rejects.toMatchObject({ status: 503 })
      expect(upstreamRefresh).not.toHaveBeenCalled()
      await expect(store.get('s1')).resolves.not.toBeNull()
    })

    it.each([
      ['503', new ContextRequestError(503, 'SERVICE_UNAVAILABLE'), 503],
      ['429 with a retry hint', new ContextRequestError(429, 'RATE_LIMIT_EXCEEDED', 7), 429],
      ['401 changed context', changed(), 401],
    ])(
      'a %s from the post-rotation check is terminal and keeps its own status',
      async (_n, failure, status) => {
        const verifyBinding = vi
          .fn()
          .mockResolvedValueOnce(undefined) // caller stage
          .mockResolvedValueOnce(undefined) // owner re-read
          .mockRejectedValueOnce(failure) // next, after the rotation
        const error = await call({ verifyBinding }).catch((e: unknown) => e)
        // The cause is not relabeled as a changed context.
        expect(error).toBe(failure)
        expect((error as ContextRequestError).status).toBe(status)
        await expect(store.get('s1')).resolves.toBeNull()
      }
    )

    it('hands the probe a deadline no longer than ten seconds and an abort signal', async () => {
      const verifyBinding = vi.fn(async () => undefined)
      await call({ verifyBinding })
      for (const [, options] of verifyBinding.mock.calls as unknown as [
        unknown,
        { deadlineMs: number; signal: AbortSignal },
      ][]) {
        expect(options.deadlineMs).toBeLessThanOrEqual(10_000)
        expect(options.deadlineMs).toBeGreaterThan(0)
        expect(options.signal).toBeInstanceOf(AbortSignal)
      }
    })
  })

  describe('unknown outcomes', () => {
    it('an upstream transport error without a response is transient: the session is kept', async () => {
      const upstreamRefresh = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('network'), { code: 'network' }))
      await expect(call({ upstreamRefresh })).rejects.toMatchObject({ code: 'network' })
      await expect(store.get('s1')).resolves.toMatchObject({ refreshToken: 'rt-1' })
    })

    it('publication that can never be proven is terminal and surfaces as a temporary failure', async () => {
      store.casFails = 'false'
      const error = await call().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SessionPublicationUnprovenError)
      await expect(store.get('s1')).resolves.toBeNull()
    })

    it('a write whose reply was lost but landed is found by the read and verified before it is returned', async () => {
      store.casFails = 'throw'
      store.casLandsAnyway = true
      const verifyBinding = vi.fn(async () => undefined)
      await expect(call({ verifyBinding })).resolves.toMatchObject({ refreshToken: 'rt-2' })
      expect(verifyBinding).toHaveBeenCalledTimes(4)
    })

    it('a failed check of this owner own landed write does not delete the published session', async () => {
      store.casFails = 'throw'
      store.casLandsAnyway = true
      const verifyBinding = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new ContextRequestError(503, 'SERVICE_UNAVAILABLE'))
      await expect(call({ verifyBinding })).rejects.toMatchObject({ status: 503 })
      await expect(store.get('s1')).resolves.toMatchObject({ refreshToken: 'rt-2' })
    })

    it('another writer newer entry is verified before it is returned and is never deleted on failure', async () => {
      store.setIfVersionMatches = vi.fn(async () => {
        store.seed(
          's1',
          makeEntry({ refreshToken: 'rt-other', accessTokenExpiresAt: 0, version: 5 })
        )
        return false
      })
      const verifyBinding = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(changed())
      await expect(call({ verifyBinding })).rejects.toMatchObject({
        errorCode: 'AUTH_CONTEXT_CHANGED',
      })
      await expect(store.get('s1')).resolves.toMatchObject({ refreshToken: 'rt-other' })
    })

    it('a session removed during the refresh is reported as not found', async () => {
      store.setIfVersionMatches = vi.fn(async () => {
        await store.delete('s1')
        return false
      })
      await expect(call()).rejects.toBeInstanceOf(SessionNotFoundError)
    })
  })

  describe('classified outcomes and cause preservation', () => {
    it.each([
      ['a TypeError', new TypeError('schema bug')],
      [
        'a WRONGTYPE reply error',
        Object.assign(new Error('WRONGTYPE bad key'), { name: 'ReplyError' }),
      ],
    ])('%s during publication is not retried and keeps its cause', async (_n, bug) => {
      store.casThrows = bug
      const casSpy = vi.spyOn(store, 'setIfVersionMatches')
      const error = await call().catch((e: unknown) => e)
      expect(error).toBe(bug)
      expect(casSpy).toHaveBeenCalledTimes(1)
      // The rotation happened, so the post-rotation cleanup still applies.
      await expect(store.get('s1')).resolves.toBeNull()
    })

    it('an unusable successful refresh reply is a rotation that was not published: terminal, cause kept', async () => {
      const failure = new UpstreamRotationUnprovenError(new SyntaxError('bad json'))
      const upstreamRefresh = vi.fn().mockRejectedValue(failure)
      const error = await call({ upstreamRefresh }).catch((e: unknown) => e)
      expect(error).toBe(failure)
      expect((error as Error).cause).toBeInstanceOf(SyntaxError)
      await expect(store.get('s1')).resolves.toBeNull()
    })
  })

  describe('checked dispatch', () => {
    it('lease loss before the backend call was sent keeps the session and sends nothing', async () => {
      const upstreamRefresh = vi.fn(freshRefresh)
      // The caller's check passes; the owner's own first check never settles; the lease fails at 4 s.
      const verifyBinding = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementation(() => new Promise<void>(() => undefined))
      const result = call({ lock: new FailingRenewalLock(), verifyBinding, upstreamRefresh }).catch(
        (e: unknown) => e
      )
      await vi.advanceTimersByTimeAsync(4_100)
      await expect(result).resolves.toBeInstanceOf(SessionRefreshUnsafeError)
      expect(upstreamRefresh).not.toHaveBeenCalled()
      expect(store.deletes).toBe(0)
      await expect(store.get('s1')).resolves.not.toBeNull()
    })

    it('a late lock success is released and starts no owner work', async () => {
      let now = 0
      const lock = new TrackingLock()
      const acquire = vi.spyOn(lock, 'acquire').mockImplementation(async () => {
        now += 10_000 // the answer arrives long after the acquisition deadline
        return 'late'
      })
      const upstreamRefresh = vi.fn(freshRefresh)
      await expect(
        call({ lock, upstreamRefresh, timing: { stageMs: 60_000, clock: () => now } })
      ).rejects.toBeInstanceOf(SessionLockTimeoutError)
      expect(acquire).toHaveBeenCalledTimes(1)
      expect(lock.released).toBe(1)
      expect(upstreamRefresh).not.toHaveBeenCalled()
    })

    it('a step finishing after the ceiling is not used and no further step starts', async () => {
      let now = 0
      const verifyBinding = vi.fn(async () => undefined)
      const upstreamRefresh = vi.fn(async () => {
        now += 40_000 // the backend call returns after the 30 s ceiling
        return freshRefresh()
      })
      const error = await call({
        verifyBinding,
        upstreamRefresh,
        timing: { stageMs: 60_000, clock: () => now },
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SessionRefreshUnsafeError)
      // Caller check, owner re-read check; the check of the rotated credentials never started.
      expect(verifyBinding).toHaveBeenCalledTimes(2)
      await expect(store.get('s1')).resolves.toBeNull()
    })
  })

  describe('renewal during terminal cleanup', () => {
    it('keeps renewing a healthy lease through a held delete that crosses a renewal tick after the ceiling', async () => {
      const gate = deferred<void>()
      store.deleteGate = gate.promise
      store.casGate = new Promise(() => undefined)
      const lock = new TrackingLock()
      const renew = vi.spyOn(lock, 'renew')
      const result = call({
        lock,
        timing: { stageMs: 120_000, owner: { ceilingMs: 2_000 } },
      }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(2_100) // ceiling: ordinary work ends, delete starts and is held
      expect(store.deletes).toBe(1)
      expect(renew).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(4_000) // a renewal tick falls inside the held delete
      expect(renew).toHaveBeenCalled()
      gate.resolve()
      await vi.advanceTimersByTimeAsync(0)
      await expect(result).resolves.toBeInstanceOf(SessionRefreshUnsafeError)
      await expect(store.get('s1')).resolves.toBeNull()
      // After the owner finished, renewal is over.
      const calls = renew.mock.calls.length
      await vi.advanceTimersByTimeAsync(20_000)
      expect(renew.mock.calls.length).toBe(calls)
    })
  })
})
