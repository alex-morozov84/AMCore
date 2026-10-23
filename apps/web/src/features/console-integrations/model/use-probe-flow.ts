'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { IntegrationErrorCode, type ProbePreparation, type ProbeReceipt } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { getErrorCode, useApiError } from '@/shared/api'
import { consoleApi } from '@/shared/api/console-api'
import { ApiNetworkError, ApiRequestError } from '@/shared/api/http-client'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'

export type ProbePhase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'confirm'; prepared: ProbePreparation }
  | { kind: 'sending'; attemptId: string }
  | { kind: 'checking'; attemptId: string }
  | { kind: 'result'; receipt: ProbeReceipt }
  | { kind: 'latest' }
  | { kind: 'notStored' }
  | { kind: 'unreadable' }
  | { kind: 'failed'; message: string; code: string | null; canRestart: boolean }

/** Failures after which only a fresh prepare helps. */
const RESTART_CODES: ReadonlySet<string> = new Set([
  IntegrationErrorCode.INTEGRATION_ATTEMPT_EXPIRED,
  IntegrationErrorCode.INTEGRATION_RECIPIENT_CHANGED,
  IntegrationErrorCode.INTEGRATION_CONFIG_CHANGED,
  IntegrationErrorCode.INTEGRATION_ATTEMPT_MISMATCH,
])

const RECOVERY_INTERVAL_MS = 2_000
const RECOVERY_ATTEMPTS = 8
const INPROGRESS_ATTEMPTS = 6

/** A response that never arrived or a gateway timeout: the attempt may still have run. */
function isLostResponse(error: unknown): boolean {
  if (error instanceof ApiNetworkError) return true
  return (
    error instanceof ApiRequestError &&
    (error.status === 504 || (error.status === 503 && !getErrorCode(error)))
  )
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

/**
 * Operator test flow: prepare (a single-use id and the masked recipient, nothing sent) -> confirm ->
 * step-up when required -> send -> receipt. A response that is lost never leads to a second POST:
 * the flow polls the read-only receipt route instead. Reopening a result is read-only.
 */
export function useProbeFlow(integrationId: string, ownAttemptId: string | null) {
  const queryClient = useQueryClient()
  const describeError = useApiError()
  const [phase, setPhase] = useState<ProbePhase>({ kind: 'idle' })
  const attemptRef = useRef<string | null>(null)
  const cancel = useRef(new AbortController())

  useEffect(() => {
    const controller = cancel.current
    return () => controller.abort()
  }, [])

  const refreshList = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['console', 'integrations'] }),
    [queryClient]
  )

  /** Polls the stored receipt until it is terminal, missing or the budget is spent. */
  const follow = useCallback(
    async (attemptId: string, attempts: number): Promise<void> => {
      const { signal } = cancel.current
      for (let index = 0; index < attempts && !signal.aborted; index += 1) {
        try {
          const receipt = await consoleApi.getIntegrationProbeReceipt(
            integrationId,
            attemptId,
            signal
          )
          if (receipt.outcome !== 'in_progress' || index === attempts - 1) {
            setPhase({ kind: 'result', receipt })
            void refreshList()
            return
          }
        } catch (error) {
          if (signal.aborted) return
          if (error instanceof ApiRequestError && error.status === 404) {
            setPhase({ kind: 'notStored' })
            return
          }
          if (index === attempts - 1) {
            setPhase({ kind: 'unreadable' })
            return
          }
        }
        await sleep(RECOVERY_INTERVAL_MS, signal)
      }
    },
    [integrationId, refreshList]
  )

  const mutation = useStepUpMutation<ProbeReceipt>({
    mutationFn: () => consoleApi.runIntegrationProbe(integrationId, attemptRef.current ?? ''),
    onSuccess: (receipt) => {
      if (receipt.outcome === 'in_progress' && attemptRef.current) {
        setPhase({ kind: 'checking', attemptId: attemptRef.current })
        void follow(attemptRef.current, INPROGRESS_ATTEMPTS)
        return
      }
      setPhase({ kind: 'result', receipt })
      void refreshList()
    },
    onError: (error) => {
      if (isLostResponse(error) && attemptRef.current) {
        setPhase({ kind: 'checking', attemptId: attemptRef.current })
        void follow(attemptRef.current, RECOVERY_ATTEMPTS)
        return true
      }
      const code = getErrorCode(error) ?? null
      setPhase({
        kind: 'failed',
        message: describeError(error).message,
        code,
        canRestart: code !== null && RESTART_CODES.has(code),
      })
      void refreshList()
      return true
    },
  })

  const start = useCallback(async () => {
    setPhase({ kind: 'preparing' })
    try {
      const prepared = await consoleApi.prepareIntegrationProbe(integrationId)
      attemptRef.current = prepared.attemptId
      setPhase({ kind: 'confirm', prepared })
    } catch (error) {
      setPhase({
        kind: 'failed',
        message: describeError(error).message,
        code: getErrorCode(error) ?? null,
        canRestart: false,
      })
      void refreshList()
    }
  }, [describeError, integrationId, refreshList])

  const confirm = useCallback(() => {
    if (!attemptRef.current) return
    setPhase({ kind: 'sending', attemptId: attemptRef.current })
    void mutation.confirm()
  }, [mutation])

  /** Read-only: the operator's own attempt when there is one, otherwise the platform's latest. */
  const reopen = useCallback(() => {
    if (!ownAttemptId) {
      setPhase({ kind: 'latest' })
      return
    }
    setPhase({ kind: 'checking', attemptId: ownAttemptId })
    void follow(ownAttemptId, 1)
  }, [follow, ownAttemptId])

  const close = useCallback(() => {
    mutation.closeStepUp()
    setPhase({ kind: 'idle' })
    void refreshList()
  }, [mutation, refreshList])

  return { phase, start, confirm, reopen, close, mutation }
}
