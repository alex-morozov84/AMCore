'use client'

import { useEffect, useId, useRef, useState } from 'react'
import {
  AuthErrorCode,
  createUuidV7,
  type WorkCommand,
  workCommandSchema,
  type WorkReceipt,
  workReceiptSchema,
} from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { ApiRequestError, getErrorCode } from '@/shared/api'
import { consoleApi } from '@/shared/api/console-api'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'

import 'client-only'

/** Captured inputs never follow refreshed rows. Only an explicit new confirmation creates a new ID. */
export function useBackgroundCommand() {
  const instance = useId()
  const frozen = useRef<WorkCommand | null>(null)
  const submitted = useRef(false)
  const submittedAt = useRef(0)
  const visibleReceipt = useRef<string | null>(null)
  const [command, setCommand] = useState<WorkCommand | null>(null)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<WorkReceipt | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  useEffect(() => {
    const openStoredReceipt = () => {
      const stored = z.uuidv7().safeParse(new URL(window.location.href).searchParams.get('receipt'))
      visibleReceipt.current = stored.success ? stored.data : null
      submittedAt.current = performance.now()
      setReceiptId(visibleReceipt.current)
      setCommand(null)
      setReceipt(null)
      setError(null)
      setUnconfirmed(false)
    }
    openStoredReceipt()
    window.addEventListener('popstate', openStoredReceipt)
    return () => window.removeEventListener('popstate', openStoredReceipt)
  }, [])
  const action = useStepUpMutation({
    mutationFn: async () => {
      if (!frozen.current || submitted.current) throw new Error('COMMAND_ALREADY_SUBMITTED')
      submitted.current = true
      submittedAt.current = performance.now()
      try {
        return workReceiptSchema.parse(
          await consoleApi.requestBackgroundWorkCommand(frozen.current)
        )
      } catch (failure) {
        // The shared password-confirmation helper permits one retry after this definitive admission denial.
        if (getErrorCode(failure) === AuthErrorCode.STEP_UP_REQUIRED) submitted.current = false
        throw failure
      }
    },
    onSuccess: (result) => {
      if (result.commandId !== visibleReceipt.current) return
      retainReceiptUrl(result.commandId)
      setReceipt(result)
      setError(null)
      setUnconfirmed(false)
    },
    onError: (failure) => {
      if (frozen.current?.commandId !== visibleReceipt.current) return true
      setError(failure)
      // Invalid/missing success bodies also leave the command effect uncertain.
      const uncertain =
        !(failure instanceof ApiRequestError) || failure.status >= 500 || failure.status === 408
      setUnconfirmed(uncertain)
      if (uncertain) retainReceiptUrl(frozen.current!.commandId)
      else {
        setReceiptId(null)
        const url = new URL(window.location.href)
        url.searchParams.delete('receipt')
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      }
      return true
    },
  })
  const status = useQuery({
    queryKey: ['console', 'background-command', receiptId, instance],
    gcTime: 0,
    queryFn: ({ signal }) =>
      consoleApi
        .getBackgroundWorkReceipt(receiptId!, signal)
        .then((result) => workReceiptSchema.parse(result)),
    enabled: !!receiptId && (!command || unconfirmed || !!receipt),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const current = query.state.data ?? receipt
      if (performance.now() - submittedAt.current > 60000) return false
      const failure = query.state.error
      if (failure instanceof ApiRequestError && [401, 403, 429].includes(failure.status))
        return false
      if (!current) return unconfirmed ? 2000 : false
      return current.targets.some((target) =>
        ['prepared', 'dispatching', 'unknown'].includes(target.state)
      )
        ? 2000
        : false
    },
  })

  function prepare(input: Omit<WorkCommand, 'commandId'>) {
    if (action.isSubmitting || action.isSteppingUp || action.stepUp.kind !== 'closed') return false
    const captured = workCommandSchema.parse({ ...input, commandId: createUuidV7() })
    frozen.current = captured
    visibleReceipt.current = captured.commandId
    submitted.current = false
    setCommand(captured)
    setReceiptId(captured.commandId)
    setReceipt(null)
    setError(null)
    setUnconfirmed(false)
    return true
  }

  const accessLost =
    status.error instanceof ApiRequestError && [401, 403].includes(status.error.status)
  const currentReceipt = accessLost ? null : (status.data ?? receipt)
  return {
    dismissSuccessfulReceipt: () => {
      if (
        !currentReceipt ||
        currentReceipt.state !== 'applied' ||
        currentReceipt.unknownCount !== 0 ||
        !currentReceipt.targets.every((target) => target.state === 'applied')
      )
        return
      const url = new URL(window.location.href)
      if (url.searchParams.get('receipt') === currentReceipt.commandId) {
        url.searchParams.delete('receipt')
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      }
      visibleReceipt.current = null
      setReceiptId(null)
      setReceipt(null)
      setCommand(null)
      setUnconfirmed(false)
    },
    openReceipt: (id: string) => {
      if (action.isSubmitting || action.isSteppingUp || action.stepUp.kind !== 'closed')
        return false
      const parsed = z.uuidv7().safeParse(id)
      if (!parsed.success) return false
      retainReceiptUrl(parsed.data)
      visibleReceipt.current = parsed.data
      submittedAt.current = performance.now()
      frozen.current = null
      submitted.current = true
      setReceiptId(parsed.data)
      setCommand(null)
      setReceipt(null)
      setError(null)
      setUnconfirmed(false)
      return true
    },
    prepare,
    command,
    submitted: submitted.current,
    receiptId,
    receipt: currentReceipt,
    error: status.data ? null : error,
    unconfirmed: unconfirmed && !status.data,
    receiptError: status.error,
    isReadingReceipt: status.isFetching,
    refreshReceipt: () => status.refetch(),
    ...action,
  }
}

/** Publish a receipt address only after admission or a genuinely uncertain transport outcome. */
function retainReceiptUrl(id: string) {
  const url = new URL(window.location.href)
  if (url.searchParams.get('receipt') === id) return
  url.searchParams.set('receipt', id)
  window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`)
}
