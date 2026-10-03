import type { ProductAccessBootstrap } from '@amcore/shared'

import { getErrorCode, getErrorStatus, getRetryAfterMs } from '@/shared/api/errors'

import type { OrganizationContextData } from '../api/context-client'

import { type OrganizationContextInput, organizationContextTarget } from './context-input'
import { createOrganizationContextLease, type OrganizationContextRun } from './context-lease'

export interface OrganizationContextState {
  target: string
  status: 'pending' | 'ready' | 'error' | 'changed' | 'missing' | 'denied'
  error?: unknown
  retryAt?: number
}

interface SchedulerDeps {
  beforeAuthority?: () => Promise<void>
  bootstrap: (signal: AbortSignal) => Promise<ProductAccessBootstrap>
  authority: (
    input: OrganizationContextInput,
    binding: string,
    signal: AbortSignal
  ) => Promise<OrganizationContextData>
  publish: (input: OrganizationContextInput, data: OrganizationContextData) => void
}

/** Per-consumer authority lifecycle; no route, shell, browser events or global selection. */
export function createOrganizationContextScheduler(
  binding: string,
  initial: OrganizationContextInput,
  deps: SchedulerDeps
) {
  const lease = createOrganizationContextLease()
  const listeners = new Set<() => void>()
  let input = initial
  let state: OrganizationContextState = {
    target: organizationContextTarget(input),
    status: 'pending',
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined
  let run: OrganizationContextRun | undefined
  let validatedIdentity = false
  const update = (next: OrganizationContextState) => {
    state = next
    listeners.forEach((listener) => listener())
  }
  const suspend = () => update({ target: organizationContextTarget(input), status: 'pending' })

  async function cycle(verifyIdentity: boolean) {
    const selectedInput = input
    const target = organizationContextTarget(selectedInput)
    const current = lease.begin(binding, target)
    run = current
    suspend()
    if (verifyIdentity) validatedIdentity = false
    try {
      if (verifyIdentity) {
        const identity = await deps.bootstrap(current.signal)
        if (identity.binding !== binding) {
          lease.publish(current, () => update({ target, status: 'changed' }))
          return
        }
      }
      current.signal.throwIfAborted()
      await deps.beforeAuthority?.()
      current.signal.throwIfAborted()
      const data = await deps.authority(selectedInput, binding, current.signal)
      if (data.binding !== binding) {
        lease.publish(current, () => update({ target, status: 'changed' }))
        return
      }
      lease.publish(current, () => {
        validatedIdentity = true
        deps.publish(selectedInput, data)
        update({ target, status: 'ready' })
      })
    } catch (error) {
      lease.publish(current, () => {
        validatedIdentity = false
        const status = getErrorStatus(error)
        const retryDelay = getRetryAfterMs(error) ?? 0
        update({
          target,
          error,
          retryAt: retryDelay > 0 ? Date.now() + retryDelay : undefined,
          status:
            getErrorCode(error) === 'CONTEXT_SESSION_CHANGED'
              ? 'changed'
              : status === 401
                ? 'missing'
                : status === 403 || status === 404
                  ? 'denied'
                  : 'error',
        })
        if (retryDelay > 0)
          retryTimer = setTimeout(() => {
            retryTimer = undefined
            update({ ...state, retryAt: undefined })
          }, retryDelay)
      })
    }
  }

  const start = (verifyIdentity: boolean) => {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
    const work = cycle(verifyIdentity)
    pending = work
    void work.finally(() => {
      if (pending === work) pending = undefined
    })
    return work
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async refresh(signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (timer) clearTimeout(timer)
      timer = undefined
      const work =
        pending ?? (!state.retryAt || Date.now() >= state.retryAt ? start(true) : undefined)
      const captured = run
      const cancel = () => {
        if (run !== captured || captured?.signal.aborted) return
        lease.retire()
        validatedIdentity = false
        suspend()
      }
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        await work
        signal?.throwIfAborted()
        if (run !== captured || captured?.signal.aborted) return 'retired' as const
        return state.status
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
    },
    activate() {
      if (pending || state.status === 'changed' || state.status === 'missing') return pending
      if (state.retryAt && Date.now() < state.retryAt) return
      if (timer) clearTimeout(timer)
      lease.retire()
      validatedIdentity = false
      suspend()
      timer = setTimeout(() => {
        timer = undefined
        void start(true)
      }, 100)
    },
    setInput(next: OrganizationContextInput) {
      if (organizationContextTarget(next) === organizationContextTarget(input)) return
      lease.retire()
      input = next
      if (state.status === 'changed' || state.status === 'missing') {
        update({ ...state, target: organizationContextTarget(input) })
        return
      }
      if (state.retryAt && Date.now() < state.retryAt) {
        update({ ...state, target: organizationContextTarget(input) })
        return
      }
      if (timer) {
        suspend()
        return
      }
      void start(!validatedIdentity)
    },
    stop() {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = undefined
      pending = undefined
      lease.retire()
      run = undefined
      validatedIdentity = false
    },
    async action<T>(
      work: (context: OrganizationContextRun) => Promise<T>,
      publish: (value: T) => void
    ) {
      const captured = run
      if (!captured || state.status !== 'ready') return
      const value = await work(captured)
      lease.publish(captured, () => publish(value))
    },
  }
}
