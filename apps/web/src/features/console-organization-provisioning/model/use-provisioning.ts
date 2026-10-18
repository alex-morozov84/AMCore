'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AuthErrorCode,
  createInvitationOperationId,
  DEFAULT_LOCALE,
  type ProductAccessBootstrap,
  provisioningCreateSchema,
  type SupportedLocale,
} from '@amcore/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { provisioningClient as api } from '@/shared/api/console/provisioning-client'
import { getErrorCode, getErrorStatus, getRetryAfterMs } from '@/shared/api/errors'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'

import {
  emptyProvisioningDraft,
  type PendingProvisioning,
  type ProvisioningDraft,
  type ProvisioningJournal,
  readProvisioningJournal,
  writeProvisioningJournal,
} from './journal'

export function useProvisioning(admission: ProductAccessBootstrap, orgId?: string) {
  const [record, setRecord] = useState<ProvisioningJournal>()
  const current = useRef<ProvisioningJournal | undefined>(undefined)
  const controller = useRef<AbortController | undefined>(undefined)
  const alive = useRef(false)
  const [createdId, setCreatedId] = useState<string>()
  const [retired, setRetired] = useState(false)
  const [error, setError] = useState<unknown>()
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [retryAt, setRetryAt] = useState<number>()
  const [expiredProof, setExpiredProof] = useState<{
    row: ProvisioningJournal
    life: AbortController
    attempt: number
  }>()
  const [checking, setChecking] = useState(false)
  const request = useRef(0)
  const target = useRef<{ row: ProvisioningJournal; life: AbortController } | undefined>(undefined)
  const scope = orgId ?? 'create'
  const cache = useQueryClient()
  const save = (row: ProvisioningJournal) => {
    if (!alive.current) return
    current.current = row
    setRecord(row)
    setStorageAvailable(writeProvisioningJournal(row, scope))
  }
  useEffect(() => {
    alive.current = true
    const life = new AbortController()
    controller.current = life
    request.current++
    target.current = undefined
    setRetired(false)
    setChecking(false)
    setExpiredProof(undefined)
    const saved = readProvisioningJournal(admission.binding, admission.actor.id, scope)
    save(
      saved ?? {
        version: 1,
        actorId: admission.actor.id,
        binding: admission.binding,
        at: Date.now(),
        open: false,
        step: 1,
        draft: emptyProvisioningDraft,
        organizationId: orgId,
      }
    )
    return () => {
      alive.current = false
      life.abort()
    }
  }, [admission.binding, admission.actor.id, scope, orgId])
  function active(row: ProvisioningJournal, life: AbortController) {
    return controller.current === life && !life.signal.aborted && current.current === row
  }
  async function identity(life = controller.current!) {
    const session = await api.session(life.signal)
    if (controller.current !== life || life.signal.aborted) throw new Error('retired-callback')
    if (
      !alive.current ||
      session.binding !== admission.binding ||
      session.actor.id !== admission.actor.id
    ) {
      if (alive.current) {
        life.abort()
        setRetired(true)
      }
      throw new Error('provisioning-session-retired')
    }
  }
  const policy = useQuery({
    queryKey: ['provisioning-policy', admission.binding],
    enabled: !!record && !retired,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      await identity()
      return api.policy(admission.binding, signal)
    },
  })
  const statusKey = ['provisioning-progress', admission.binding, record?.organizationId]
  const statusQuery = useQuery({
    queryKey: statusKey,
    enabled: !!orgId && !!record?.organizationId && !retired,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      await identity()
      return api.progress(admission.binding, current.current!.organizationId!, signal)
    },
  })
  function committed(row: ProvisioningJournal, organizationId: string) {
    if (!orgId) setCreatedId(organizationId)
    save({
      ...row,
      organizationId,
      pending: undefined,
      expiredOperationId: undefined,
      draft: emptyProvisioningDraft,
      open: false,
    })
    setExpiredProof(undefined)
    setError(undefined)
    void cache.invalidateQueries({ queryKey: ['provisioning-progress', admission.binding] })
    void cache.invalidateQueries({ queryKey: ['organization-attention'] })
    void cache.invalidateQueries({ queryKey: ['initial-organization-state'] })
    void cache.invalidateQueries({ queryKey: ['organization-administration'] })
  }
  const mutation = useStepUpMutation({
    mutationFn: async () => {
      const captured = target.current
      if (!captured || !active(captured.row, captured.life)) return
      const { row, life } = captured
      if (!row.pending || retired || (retryAt ?? 0) > Date.now()) return
      const attempt = ++request.current
      const applies = () => active(row, life) && request.current === attempt
      setExpiredProof(undefined)
      setChecking(false)
      let commandFailed = false
      try {
        await identity(life)
        if (!applies()) return
        const command = row.pending
        const sending =
          command.kind === 'create'
            ? api.create(admission.binding, command.input, life.signal)
            : api.recover(
                admission.binding,
                row.organizationId!,
                command.kind,
                command.input,
                life.signal
              )
        const result = await sending.catch((failure: unknown) => {
          commandFailed = true
          throw failure
        })
        await identity(life)
        if (applies()) committed(row, result.organizationId)
      } catch (failure) {
        if (!applies()) return
        if (commandFailed && getErrorCode(failure) === AuthErrorCode.STEP_UP_REQUIRED) throw failure
        setError(failure)
        setRetryAt(Date.now() + (getRetryAfterMs(failure) ?? 0))
        const status = getErrorStatus(failure)
        if (
          commandFailed &&
          ((status && status >= 400 && status < 500) ||
            [
              'PROVISIONING_EMAIL_NOT_CONFIGURED',
              'PROVISIONING_ADMISSION_UNAVAILABLE',
              'PROVISIONING_BUSY',
            ].includes(getErrorCode(failure) ?? ''))
        ) {
          save({ ...row, pending: undefined })
          if (row.organizationId) void statusQuery.refetch()
        }
      }
    },
    onSuccess: () => {},
    onError: () => true,
  })
  async function confirm() {
    if (!current.current || !controller.current || mutation.stepUp.kind !== 'closed') return
    target.current = { row: current.current, life: controller.current }
    await mutation.confirm()
  }
  async function check() {
    const row = current.current
    const life = controller.current
    if (!row || !life || retired || life.signal.aborted) return
    const attempt = ++request.current
    const applies = () => active(row, life) && request.current === attempt
    setChecking(true)
    setExpiredProof(undefined)
    try {
      await identity(life)
      if (!applies()) return
      const id =
        row.pending?.kind === 'create' ? row.pending.input.operationId : row.expiredOperationId
      if (id) {
        const result = await api.lookup(admission.binding, id, life.signal)
        await identity(life)
        if (!applies()) return
        if (result.state === 'committed') committed(row, result.receipt.organizationId)
        else if (result.state === 'expired_unrecorded') {
          setExpiredProof({ row, life, attempt })
          setError(undefined)
        }
      } else await statusQuery.refetch()
    } catch (failure) {
      if (applies()) setError(failure)
    } finally {
      if (request.current === attempt && controller.current === life && !life.signal.aborted)
        setChecking(false)
    }
  }
  function hasExpiredProof() {
    return (
      !!expiredProof &&
      expiredProof.attempt === request.current &&
      active(expiredProof.row, expiredProof.life)
    )
  }
  function edit(draft: ProvisioningDraft, step = current.current!.step) {
    if (!current.current || current.current.pending || current.current.expiredOperationId) return
    save({ ...current.current, draft, step, at: Date.now(), open: true })
    setError(undefined)
  }
  function start(locale: SupportedLocale = DEFAULT_LOCALE) {
    if ((current.current?.pending || current.current?.expiredOperationId) && !hasExpiredProof())
      return
    save({
      ...current.current!,
      open: true,
      step: 1,
      organizationId: undefined,
      pending: undefined,
      expiredOperationId: undefined,
      draft: { ...current.current!.draft, inviteLocale: locale },
      at: Date.now(),
    })
    setError(undefined)
    setExpiredProof(undefined)
  }
  function reset() {
    if (
      !current.current ||
      current.current.pending ||
      current.current.expiredOperationId ||
      mutation.isSubmitting ||
      mutation.isSteppingUp
    )
      return
    save({ ...current.current, draft: emptyProvisioningDraft, step: 1, open: true, at: Date.now() })
    setError(undefined)
  }
  function close() {
    if (!current.current || current.current.pending || current.current.expiredOperationId) return
    save({ ...current.current, open: false })
    setError(undefined)
  }
  async function submit(pending?: PendingProvisioning) {
    if (
      !current.current ||
      retired ||
      controller.current?.signal.aborted ||
      mutation.stepUp.kind !== 'closed'
    )
      return
    if (pending && (current.current.pending || current.current.expiredOperationId)) return
    if (pending) save({ ...current.current, pending, at: Date.now() })
    else if (!current.current.pending) {
      const draft = current.current.draft
      save({
        ...current.current,
        pending: {
          kind: 'create',
          input: provisioningCreateSchema.parse({
            ...draft,
            slug: draft.slug || undefined,
            operationId: createInvitationOperationId(),
          }),
        },
        at: Date.now(),
      })
    }
    setError(undefined)
    await confirm()
  }
  return {
    record,
    createdId,
    dismissCreated: () => setCreatedId(undefined),
    reset,
    clearError: () => setError(undefined),
    error: error ?? statusQuery.error ?? policy.error,
    storageAvailable,
    retired,
    policy,
    status: statusQuery,
    mutation: { ...mutation, confirm },
    retryAt,
    expiredAbsent: !!record && hasExpiredProof(),
    edit,
    start,
    close,
    submit,
    check,
    busy:
      checking ||
      mutation.isSubmitting ||
      mutation.isSteppingUp ||
      mutation.stepUp.kind !== 'closed',
    frozen: !!record?.pending || !!record?.expiredOperationId,
  }
}
