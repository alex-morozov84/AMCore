import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'

import { getRetryAfterMs } from '@/shared/api/errors'
import { withDeadline } from '@/shared/lib/with-deadline'

import type { OrganizationAccessController } from './access-controller'

import 'client-only'

/** Each target/query owns a separate fence; list queries never retire an editor. */
export function useOrganizationRead<T>(
  controller: OrganizationAccessController,
  identity: string,
  load: (signal: AbortSignal) => Promise<T>,
  options?: { namespace: string; timeoutMs: number; secondary?: boolean }
) {
  const client = useQueryClient()
  const key = useMemo(
    () => [options?.namespace ?? 'organization-members', identity] as const,
    [identity, options?.namespace]
  )
  const ready = useSyncExternalStore(controller.subscribe, controller.allowed, () => false)
  const query = useQuery<T>({
    queryKey: key,
    queryFn: skipToken,
    enabled: false,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [state, setState] = useState<{
    identity: string
    error?: unknown
    pending: boolean
    retryAt?: number
  }>({
    identity,
    pending: true,
  })
  const cooldown = useRef<{ identity: string; retryAt: number; error: unknown } | undefined>(
    undefined
  )
  const sequence = useRef(0)
  const abort = useRef<AbortController>(undefined)
  const loader = useRef(load)
  loader.current = load
  const pending = useRef<{ identity: string; promise: Promise<T | undefined> }>(undefined)
  const refresh = useCallback(
    (parentSignal?: AbortSignal) => {
      if (cooldown.current?.identity === identity && Date.now() < cooldown.current.retryAt)
        return Promise.reject(cooldown.current.error)
      if (pending.current?.identity === identity) return pending.current.promise
      const work = (async () => {
        const run = ++sequence.current
        const epoch = controller.capture()
        abort.current?.abort()
        const signal = new AbortController()
        abort.current = signal
        const cancel = () => signal.abort()
        parentSignal?.addEventListener('abort', cancel, { once: true })
        if (parentSignal?.aborted) cancel()
        setState({ identity, pending: true })
        const current = () =>
          sequence.current === run && controller.current(epoch) && !signal.signal.aborted
        try {
          const data = await withDeadline(
            loader.current(signal.signal),
            options?.timeoutMs ?? 5000,
            signal
          )
          if (current()) {
            client.setQueryData(key, data)
            setState({ identity, pending: false })
            return data
          }
        } catch (error) {
          if (sequence.current === run && controller.current(epoch)) {
            const delay = getRetryAfterMs(error)
            const retryAt = delay ? Date.now() + delay : undefined
            cooldown.current = retryAt ? { identity, retryAt, error } : undefined
            setState({ identity, error, pending: false, retryAt })
          }
          throw error
        } finally {
          parentSignal?.removeEventListener('abort', cancel)
        }
      })()
      pending.current = { identity, promise: work }
      void work.then(
        () => {
          if (pending.current?.promise === work) pending.current = undefined
        },
        () => {
          if (pending.current?.promise === work) pending.current = undefined
        }
      )
      return work
    },
    [client, controller, identity, key, options?.timeoutMs]
  )
  useEffect(() => {
    if (ready) void refresh().catch(() => undefined)
    return () => {
      sequence.current++
      pending.current = undefined
      abort.current?.abort()
    }
  }, [ready, refresh])
  useEffect(() => {
    if (state.retryAt === undefined) return
    const timer = setTimeout(
      () =>
        setState((latest) =>
          latest.identity === state.identity ? { ...latest, retryAt: undefined } : latest
        ),
      Math.max(0, state.retryAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [state.retryAt, state.identity])
  useEffect(() => controller.registerRead(options?.secondary
    ? signal => refresh(signal).catch(() => undefined)
    : refresh), [controller, refresh, options?.secondary])
  return {
    ...(state.identity === identity ? state : { identity, pending: true }),
    data: state.identity === identity ? query.data : undefined,
    refresh,
    ready,
    // Authority readiness is distinct from success of this identity's current read.
    available:
      ready &&
      state.identity === identity &&
      !state.pending &&
      !state.error &&
      query.data !== undefined,
  }
}
