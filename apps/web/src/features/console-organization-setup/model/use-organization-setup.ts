'use client'

import { useEffect, useRef, useState } from 'react'
import type { ProductAccessBootstrap } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { establishmentConsoleClient as api } from '@/shared/api/console/establishment-client'
import { getErrorCode, getErrorStatus, getRetryAfterMs } from '@/shared/api/errors'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'

import {
  readSetupJournal,
  type SetupJournalRecord,
  type SetupPending,
  type SetupStep,
  writeSetupJournal,
} from './journal'

/** Bound to one operator session; unmount retires every late callback. */
export function useOrganizationSetup(admission: ProductAccessBootstrap) {
  const [record, setRecord] = useState<SetupJournalRecord>()
  const current = useRef<SetupJournalRecord | undefined>(undefined)
  const alive = useRef(false)
  const abort = useRef<AbortController | undefined>(undefined)
  const [retired, setRetired] = useState(false)
  const [error, setError] = useState<unknown>()
  const [uncertain, setUncertain] = useState(false)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [retryAt, setRetryAt] = useState<number>()
  const [recoverableRejection, setRecoverableRejection] = useState(false)
  const save = (next: SetupJournalRecord) => {
    if (!alive.current) return
    current.current = next
    setRecord(next)
    setStorageAvailable(writeSetupJournal(next))
  }
  useEffect(() => {
    alive.current = true
    abort.current = new AbortController()
    const restored = readSetupJournal(admission.binding, admission.actor.id)
    save(
      restored ?? {
        version: 1,
        binding: admission.binding,
        actorId: admission.actor.id,
        draft: { email: '', name: '', slug: '' },
      }
    )
    setUncertain(!!restored?.pending)
    return () => {
      alive.current = false
      abort.current?.abort()
    }
  }, [admission.binding, admission.actor.id])

  async function identity(): Promise<void> {
    const session = await api.session(abort.current!.signal)
    if (
      !alive.current ||
      session.binding !== admission.binding ||
      session.actor.id !== admission.actor.id
    ) {
      if (alive.current) setRetired(true)
      throw new Error('setup-session-retired')
    }
  }
  const status = useQuery({
    queryKey: ['initial-organization-state', admission.binding],
    queryFn: async ({ signal }) => {
      await identity()
      return api.status(admission.binding, signal)
    },
    enabled: !!record && !retired,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
  const selectedId = status.data?.ids?.userId ?? record?.selected?.userId
  const readable = status.data?.state === 'eligible-empty' || !!status.data?.ids
  const account = useQuery({
    queryKey: ['initial-organization-account', admission.binding, selectedId],
    queryFn: async ({ signal }) => {
      await identity()
      return api.account(admission.binding, selectedId!, signal)
    },
    enabled: !!selectedId && readable && !retired && !status.isFetching,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  const mutation = useStepUpMutation({
    mutationFn: async () => {
      const pending = current.current?.pending
      if (!pending || retired || (retryAt ?? 0) > Date.now())
        throw new Error('setup-request-unavailable')
      await identity()
      if (pending.kind === 'prepare') {
        // Even a repeat after a lost reply must recheck server lifecycle before preparing.
        const install = await api.status(admission.binding, abort.current!.signal)
        if (install.state !== 'eligible-empty') throw new Error('setup-closed-before-prepare')
        const result = await api.prepare(admission.binding, pending.input, abort.current!.signal)
        await identity()
        const selected = await api.account(admission.binding, result.userId, abort.current!.signal)
        await identity()
        return { kind: 'prepare' as const, selected }
      }
      const result = await api.bootstrap(admission.binding, pending.input, abort.current!.signal)
      await identity()
      return { kind: 'bootstrap' as const, result }
    },
    onSuccess: (result) => {
      if (!alive.current || !current.current) return
      save({
        ...current.current,
        pending: undefined,
        ...(result.kind === 'prepare'
          ? {
              selected: result.selected,
              step: result.selected.emailVerified ? 'organization' : 'administrator',
            }
          : {}),
      })
      setUncertain(false)
      setError(undefined)
      setRecoverableRejection(false)
      void status.refetch()
    },
    onError: (failure) => {
      if (!alive.current) return true
      setError(failure)
      const code = getErrorCode(failure)
      if (code === 'CONTEXT_SESSION_CHANGED' || getErrorStatus(failure) === 401) setRetired(true)
      const known = [400, 403, 409, 422].includes(getErrorStatus(failure) ?? 0)
      setUncertain(!known)
      setRecoverableRejection(known && !uncertain)
      const delay = getRetryAfterMs(failure)
      if (delay !== undefined) setRetryAt(Date.now() + delay)
      void status.refetch()
      return true
    },
  })
  const effectiveRetryAt = Math.max(
    retryAt ?? 0,
    status.errorUpdatedAt + (getRetryAfterMs(status.error) ?? 0),
    account.errorUpdatedAt + (getRetryAfterMs(account.error) ?? 0)
  )
  const busy = mutation.isSubmitting || mutation.isSteppingUp || mutation.stepUp.kind !== 'closed'
  const eligible =
    status.isSuccess && !status.isFetching && status.data.state === 'eligible-empty' && !retired
  return {
    record,
    status,
    account,
    mutation,
    busy,
    retired,
    error,
    uncertain,
    storageAvailable,
    retryAt: effectiveRetryAt,
    editable: eligible && !busy && !record?.pending,
    setDraft(draft: SetupJournalRecord['draft']) {
      if (eligible && !busy && current.current && !current.current.pending)
        save({ ...current.current, draft })
    },
    goTo(step: SetupStep) {
      if (!eligible || busy || !current.current || current.current.pending) return
      if (
        step !== 'administrator' &&
        (!account.isSuccess || account.isFetching || !account.data.emailVerified)
      )
        return
      save({ ...current.current, step })
    },
    review(input: Pick<SetupJournalRecord['draft'], 'name' | 'slug'>) {
      if (!eligible || busy || !current.current || current.current.pending) return
      if (!account.isSuccess || account.isFetching || !account.data.emailVerified) return
      save({ ...current.current, draft: { ...current.current.draft, ...input }, step: 'review' })
    },
    changeRecipient() {
      if (eligible && !busy && current.current && !current.current.pending)
        save({
          ...current.current,
          previousRecipientId:
            current.current.selected?.userId ?? current.current.previousRecipientId,
          selected: undefined,
          step: 'administrator',
        })
    },
    submit(pending: SetupPending) {
      if (!eligible || busy || !current.current || current.current.pending) return
      save({ ...current.current, pending })
      setError(undefined)
      setUncertain(false)
      void mutation.confirm()
    },
    repeat() {
      if (
        !busy &&
        Date.now() >= effectiveRetryAt &&
        record?.pending &&
        (record.pending.kind === 'bootstrap' || eligible)
      )
        void mutation.confirm()
    },
    correct() {
      if (eligible && !busy && recoverableRejection && current.current) {
        save({ ...current.current, pending: undefined })
        setError(undefined)
        setRecoverableRejection(false)
      }
    },
    canCorrect: eligible && recoverableRejection && !busy,
    refresh: async () => {
      if (Date.now() < effectiveRetryAt) return
      await status.refetch()
      if (readable) await account.refetch()
    },
  }
}
