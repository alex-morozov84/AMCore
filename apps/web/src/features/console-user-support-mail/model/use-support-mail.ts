'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  SupportMailErrorCode,
  type SupportMailKind,
  type SupportMailPreparation,
  type SupportMailReceipt,
} from '@amcore/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useApiError } from '@/shared/api'
import { consoleApi } from '@/shared/api/console-api'
import { ApiRequestError } from '@/shared/api/http-client'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'
import { toast } from '@/shared/ui/toast'

interface Operation {
  kind: SupportMailKind
  prepared?: SupportMailPreparation
  cancelled: boolean
  confirmed?: boolean
}
export type MailPhase = {
  kind: 'idle' | 'preparing' | 'confirm' | 'sending' | 'checking' | 'result' | 'error'
  mailKind?: SupportMailKind
  preparation?: SupportMailPreparation
  receipt?: SupportMailReceipt
  message?: string
}
const wait = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, 2000)
    signal.addEventListener('abort', done, { once: true })
  })

const preEffectStatuses: Readonly<Record<string, number>> = {
  [SupportMailErrorCode.SUPPORT_MAIL_LIMIT]: 429,
  [SupportMailErrorCode.SUPPORT_MAIL_NOT_ELIGIBLE]: 409,
  [SupportMailErrorCode.SUPPORT_MAIL_BINDING_CHANGED]: 409,
  [SupportMailErrorCode.SUPPORT_MAIL_ATTEMPT_EXPIRED]: 410,
  [SupportMailErrorCode.SUPPORT_MAIL_UNAVAILABLE]: 503,
}

export function useSupportMail(userId: string, actorId: string) {
  const locale = useLocale()
  const t = useTranslations('console.supportMail')
  const queryClient = useQueryClient()
  const key = ['console', 'support-mail', actorId, userId, locale] as const
  const describe = useApiError()
  const [phase, setPhase] = useState<MailPhase>({ kind: 'idle' })
  const [authorityLost, setAuthorityLost] = useState(false)
  const operation = useRef<Operation | null>(null)
  const reads = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const status = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => consoleApi.getSupportMailStatus(userId, signal),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const current = (op: Operation): boolean =>
    mounted.current && operation.current === op && !op.cancelled
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['console', 'support-mail', actorId, userId] })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (operation.current) operation.current.cancelled = true
      reads.current?.abort()
    }
  }, [])

  function close() {
    if (operation.current) operation.current.cancelled = true
    operation.current = null
    reads.current?.abort()
    mutation.closeStepUp()
    setPhase({ kind: 'idle' })
    void invalidate()
  }

  function complete(op: Operation, receipt: SupportMailReceipt, feedback: boolean) {
    if (!current(op)) return
    if (
      feedback &&
      receipt.evidence !== 'unconfirmed' &&
      ['accepted', 'simulated'].includes(receipt.outcome)
    ) {
      const outcome = receipt.outcome as 'accepted' | 'simulated'
      toast.add({
        type: outcome === 'accepted' ? 'success' : 'info',
        title: t(`toast.${outcome}`),
        description: t(`toastDescription.${outcome}`),
      })
      close()
      return
    }
    setPhase({ kind: 'result', mailKind: op.kind, preparation: op.prepared, receipt })
    void invalidate()
  }

  async function follow(op: Operation, attemptId: string, count = 8, feedback = false) {
    reads.current?.abort()
    const controller = new AbortController()
    reads.current = controller
    setPhase({ kind: 'checking', mailKind: op.kind, preparation: op.prepared })
    for (let index = 0; index < count && current(op) && !controller.signal.aborted; index += 1) {
      try {
        const receipt = await consoleApi.getSupportMailReceipt(
          userId,
          attemptId,
          AbortSignal.any([controller.signal, AbortSignal.timeout(3000)])
        )
        if (!current(op)) return
        if (receipt.evidence !== 'unconfirmed' && receipt.outcome !== 'in_progress') {
          complete(op, receipt, feedback)
          return
        }
        if (index === count - 1) {
          setPhase({ kind: 'result', mailKind: op.kind, preparation: op.prepared, receipt })
          return
        }
      } catch (error) {
        if (!current(op) || controller.signal.aborted) return
        if (error instanceof ApiRequestError && [401, 403].includes(error.status)) {
          setAuthorityLost(true)
          setPhase({ kind: 'error', mailKind: op.kind, message: describe(error).message })
          return
        }
        if (error instanceof ApiRequestError && [404, 410].includes(error.status)) {
          setPhase({ kind: 'error', mailKind: op.kind, message: describe(error).message })
          return
        }
        if (index === count - 1) {
          setPhase({
            kind: 'result',
            mailKind: op.kind,
            preparation: op.prepared,
            receipt: { evidence: 'unconfirmed', attemptId },
          })
          return
        }
      }
      await wait(controller.signal)
    }
  }

  const mutation = useStepUpMutation({
    mutationFn: async () => {
      const op = operation.current
      if (!op || !current(op) || !op.prepared) throw new Error('Support mail flow closed')
      setPhase({ kind: 'sending', mailKind: op.kind, preparation: op.prepared })
      const receipt = await consoleApi.sendSupportMail(userId, op.prepared.attemptId)
      return { op, receipt }
    },
    onSuccess: ({ op, receipt }) => {
      if (!current(op)) return
      if (receipt.evidence === 'unconfirmed' || receipt.outcome === 'in_progress')
        void follow(op, receipt.attemptId, 8, true)
      else complete(op, receipt, true)
    },
    onError: (error) => {
      const op = operation.current
      if (!op || !current(op) || !op.prepared) return true
      if (error instanceof ApiRequestError && [401, 403].includes(error.status)) {
        setAuthorityLost(true)
        setPhase({ kind: 'error', mailKind: op.kind, message: describe(error).message })
        return true
      }
      if (
        error instanceof ApiRequestError &&
        preEffectStatuses[error.body?.errorCode ?? ''] === error.status &&
        error.body?.details?.effect === 'none' &&
        error.body.details.tokenIssued === false
      ) {
        setPhase({ kind: 'error', mailKind: op.kind, message: describe(error).message })
        void invalidate()
        return true
      }
      // Every unproved POST result is recovered via reads, including 500/502 and malformed 2xx.
      void follow(op, op.prepared.attemptId, 8, true)
      return true
    },
  })

  async function start(kind: SupportMailKind) {
    if (
      (operation.current && !operation.current.prepared && !operation.current.cancelled) ||
      mutation.isSubmitting ||
      phase.kind !== 'idle' ||
      status.isFetching ||
      authorityLost
    )
      return
    const op: Operation = { kind, cancelled: false }
    operation.current = op
    setPhase({ kind: 'preparing', mailKind: kind })
    try {
      const prepared = await consoleApi.prepareSupportMail(userId, kind)
      if (!current(op)) return
      op.prepared = prepared
      setPhase({ kind: 'confirm', mailKind: kind, preparation: prepared })
    } catch (error) {
      if (current(op))
        setPhase({ kind: 'error', mailKind: op.kind, message: describe(error).message })
    }
  }

  function reopen(kind: SupportMailKind, attemptId: string) {
    if (phase.kind !== 'idle') return
    const op: Operation = { kind, cancelled: false }
    operation.current = op
    void follow(op, attemptId, 1)
  }
  async function refresh() {
    const result = await status.refetch()
    if (mounted.current && result.isSuccess) setAuthorityLost(false)
  }
  const authError =
    status.error instanceof ApiRequestError && [401, 403].includes(status.error.status)
  return {
    phase,
    status,
    mutation,
    close,
    start,
    reopen,
    refresh,
    dismissConfirmation: () =>
      setPhase((current) => ({ kind: 'idle', preparation: current.preparation })),
    authorityLost: authorityLost || authError,
    confirm: () => {
      const op = operation.current
      if (op?.prepared && !op.confirmed && phase.kind === 'confirm') {
        op.confirmed = true
        void mutation.confirm()
      }
    },
    check: () => {
      const op = operation.current
      const id = phase.receipt?.attemptId ?? op?.prepared?.attemptId
      if (op && id) void follow(op, id, 1)
    },
  }
}
