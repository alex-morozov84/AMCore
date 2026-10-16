import type { OrganizationCreationResult, ProductAccessBootstrap } from '@amcore/shared'
import { type CreateOrganizationInput, DEFAULT_LOCALE } from '@amcore/shared'

import { getErrorCode, getErrorStatus, getRetryAfterMs } from '@/shared/api/errors'

import { organizationContextClient } from '../../api/context-client'
import { organizationCreationClient } from '../../api/creation-client'
import { createOrganizationContextLease } from '../context-lease'

import { type OrganizationCreationAttempt, organizationCreationJournal } from './journal'

export interface OrganizationCreationState {
  phase:
    | 'hydrating'
    | 'idle'
    | 'pending'
    | 'unknown'
    | 'recovering'
    | 'succeeded'
    | 'rejected'
    | 'session-retired'
  attempt?: OrganizationCreationAttempt
  result?: OrganizationCreationResult
  access?: 'ready' | 'changed' | 'unavailable'
  error?: unknown
  storageAvailable: boolean
  retryAt?: number
}
type Deps = typeof organizationCreationClient &
  Pick<typeof organizationContextClient, 'bootstrap' | 'authority'>

/** One tab's frozen creation intent. Reads cannot prove rollback; only the same operation may repeat. */
export function createOrganizationCreationController(
  admission: ProductAccessBootstrap,
  deps: Deps = { ...organizationCreationClient, ...organizationContextClient },
  journal = organizationCreationJournal()
) {
  const listeners = new Set<() => void>()
  const lease = createOrganizationContextLease()
  let state: OrganizationCreationState = { phase: 'hydrating', storageAvailable: true }
  const update = (next: OrganizationCreationState) => {
    state = next
    listeners.forEach((fn) => fn())
  }
  const retired = () => {
    lease.retire()
    update({ phase: 'session-retired', storageAvailable: state.storageAvailable })
  }

  async function execute(
    kind: 'create' | 'result',
    attempt: OrganizationCreationAttempt,
    fresh = false
  ) {
    if (
      state.phase === 'session-retired' ||
      state.phase === 'pending' ||
      state.phase === 'recovering' ||
      (state.retryAt ?? 0) > Date.now()
    )
      return
    const run = lease.begin(admission.binding, attempt.input.operationId)
    const storageAvailable = journal.write(attempt)
    update({ phase: kind === 'create' ? 'pending' : 'recovering', attempt, storageAvailable })
    const currentIdentity = async () => {
      const identity = await deps.bootstrap(run.signal)
      if (run.signal.aborted) return false
      if (identity.binding !== admission.binding || identity.actor.id !== admission.actor.id) {
        retired()
        return false
      }
      return !run.signal.aborted
    }
    try {
      if (!(await currentIdentity())) return
      const result =
        kind === 'create'
          ? await deps
              .create(attempt.input, admission.binding, run.signal)
              .then((org) => ({ organizationId: org.id, completedAt: org.createdAt }))
          : await deps.result(attempt.input.operationId, admission.binding, run.signal)
      if (!(await currentIdentity())) return
      let access: 'ready' | 'changed' | 'unavailable' = 'ready'
      try {
        await deps.authority(
          { kind: 'selected', id: result.organizationId, locale: DEFAULT_LOCALE },
          admission.binding,
          run.signal
        )
      } catch (error) {
        access = [403, 404].includes(getErrorStatus(error) ?? 0) ? 'changed' : 'unavailable'
      }
      if (!(await currentIdentity())) return
      lease.publish(run, () => {
        if (access === 'ready') journal.clear(attempt)
        update({ phase: 'succeeded', attempt, result, access, storageAvailable })
      })
    } catch (error) {
      if (run.signal.aborted) return
      // Both successful and failed responses belong only to the current admission.
      try {
        if (!(await currentIdentity())) return
      } catch {
        /* Keep uncertain intent when identity cannot be reread. */
      }
      const code = getErrorCode(error)
      if (
        code === 'CONTEXT_SESSION_CHANGED' ||
        (error instanceof Error && error.message === 'CONTEXT_SESSION_CHANGED') ||
        getErrorStatus(error) === 401
      ) {
        retired()
        return
      }
      const terminal =
        code === 'ORGANIZATION_CREATION_RESULT_CHANGED' ||
        code === 'ORGANIZATION_CREATION_INTENT_MISMATCH'
      const rejected =
        fresh && [400, 403, 409, 422].includes(getErrorStatus(error) ?? 0) && !terminal
      lease.publish(run, () => {
        if (rejected) journal.clear(attempt)
        update({
          phase: rejected || terminal ? 'rejected' : 'unknown',
          error,
          storageAvailable,
          ...(rejected ? {} : { attempt }),
          retryAt:
            getRetryAfterMs(error) === undefined ? undefined : Date.now() + getRetryAfterMs(error)!,
        })
      })
    }
  }

  return {
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getSnapshot: () => state,
    hydrate() {
      const restored = journal.read(admission.binding, admission.actor.id)
      update({
        phase: restored.attempt ? 'unknown' : 'idle',
        storageAvailable: restored.available,
        ...(restored.attempt ? { attempt: restored.attempt } : {}),
      })
    },
    retire: () => {
      lease.retire()
    },
    sessionChanged: retired,
    submit(input: CreateOrganizationInput) {
      if (state.attempt || !['idle', 'rejected'].includes(state.phase)) return
      return execute(
        'create',
        {
          version: 1,
          binding: admission.binding,
          actorId: admission.actor.id,
          input: { ...input, operationId: crypto.randomUUID() },
        },
        true
      )
    },
    check: () => (state.attempt ? execute('result', state.attempt) : undefined),
    repeat: () =>
      state.attempt && state.phase !== 'rejected' ? execute('create', state.attempt) : undefined,
    dismiss() {
      if (state.phase === 'pending' || state.phase === 'recovering' || state.phase === 'unknown')
        return
      if (state.attempt) journal.clear(state.attempt)
      update({ phase: 'idle', storageAvailable: state.storageAvailable })
    },
  }
}
