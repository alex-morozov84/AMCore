'use client'

import { useEffect, useRef, useState } from 'react'
import type { ProductAccessBootstrap } from '@amcore/shared'
import { AuthErrorCode } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { administrationClient as api } from '@/shared/api/console/administration-client'
import { provisioningClient } from '@/shared/api/console/provisioning-client'
import { getErrorCode, getErrorStatus, getRetryAfterMs } from '@/shared/api/errors'
import { useStepUpMutation } from '@/shared/lib/console-step-up-mutation'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'

import {
  type AdministratorJournal,
  type AdministratorPending,
  readAdministratorJournal,
  writeAdministratorJournal,
} from './command-journal'

export function useAdministratorCommand(
  admission: ProductAccessBootstrap,
  orgId: string,
  onSuccess: (kind?: AdministratorPending['kind']) => void
) {
  const [record, setRecord] = useState<AdministratorJournal>()
  const current = useRef<AdministratorJournal | undefined>(undefined)
  const [error, setError] = useState<unknown>()
  const [retired, setRetired] = useState(false)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [retryAt, setRetryAt] = useState<number>()
  const [expiredProof, setExpiredProof] = useState<{
    row: AdministratorJournal
    life: AbortController
    attempt: number
  }>()
  const [checking, setChecking] = useState(false)
  const request = useRef(0)
  const target = useRef<{ row: AdministratorJournal; life: AbortController } | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const lifetime = useRef<AbortController | undefined>(undefined)
  const cache = useQueryClient()
  const router = useRouteProgressRouter()
  function save(row?: AdministratorJournal) {
    current.current = row
    setRecord(row)
    const stored = writeAdministratorJournal(orgId, row)
    setStorageAvailable(stored)
    return stored
  }
  useEffect(() => {
    const life = new AbortController()
    lifetime.current = life
    request.current++
    target.current = undefined
    setRetired(false)
    setChecking(false)
    setExpiredProof(undefined)
    const saved = readAdministratorJournal(orgId, admission.actor.id)
    current.current = saved
    setRecord(saved)
    setStorageAvailable(writeAdministratorJournal(orgId, saved))
    setReady(true)
    return () => life.abort()
  }, [orgId, admission.actor.id, admission.binding])
  function active(row: AdministratorJournal, life: AbortController) {
    return lifetime.current === life && !life.signal.aborted && current.current === row
  }
  async function identity(life: AbortController) {
    const session = await provisioningClient.session(life.signal)
    if (lifetime.current !== life || life.signal.aborted) throw new Error('retired-callback')
    if (session.binding !== admission.binding || session.actor.id !== admission.actor.id) {
      life.abort()
      setRetired(true)
      throw new Error('administrator-session-retired')
    }
  }
  function committed(row: AdministratorJournal) {
    save(undefined)
    setExpiredProof(undefined)
    setError(undefined)
    void cache.invalidateQueries({ queryKey: ['organization-attention'] })
    void cache.invalidateQueries({ queryKey: ['organization-administration'] })
    void cache.invalidateQueries({ queryKey: ['provisioning-progress'] })
    router.refresh()
    onSuccess(row.pending?.kind)
  }
  const mutation = useStepUpMutation({
    mutationFn: async () => {
      const captured = target.current
      if (!captured || !active(captured.row, captured.life)) return
      const { row, life } = captured
      if (retired || !storageAvailable || !row.pending || (retryAt ?? 0) > Date.now()) return
      const attempt = ++request.current
      const applies = () => active(row, life) && request.current === attempt
      setExpiredProof(undefined)
      setChecking(false)
      let commandFailed = false
      try {
        await identity(life)
        if (!applies()) return
        const command = row.pending
        const path =
          command.kind === 'create'
            ? 'invitations'
            : command.kind === 'assign'
              ? 'assign'
              : `invitations/${command.id}/${command.kind}`
        await api
          .command(admission.binding, orgId, path, command.input, life.signal)
          .catch((failure: unknown) => {
            commandFailed = true
            throw failure
          })
        await identity(life)
        if (applies()) committed(row)
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
              'PROVISIONING_BUSY',
              'PROVISIONING_ADMISSION_UNAVAILABLE',
              'PROVISIONING_EMAIL_NOT_CONFIGURED',
            ].includes(getErrorCode(failure) ?? ''))
        )
          save(undefined)
      }
    },
    onSuccess: () => {},
    onError: () => true,
  })
  async function confirm() {
    if (!current.current || !lifetime.current || mutation.stepUp.kind !== 'closed') return
    target.current = { row: current.current, life: lifetime.current }
    await mutation.confirm()
  }
  async function submit(pending: AdministratorPending) {
    if (
      !ready ||
      current.current ||
      retired ||
      lifetime.current?.signal.aborted ||
      mutation.stepUp.kind !== 'closed'
    )
      return
    if (
      !save({
        actorId: admission.actor.id,
        at: Date.now(),
        operationId: pending.input.operationId,
        pending,
      })
    )
      return
    setError(undefined)
    await confirm()
  }
  async function check() {
    const row = current.current
    const life = lifetime.current
    if (!row || !life || retired || life.signal.aborted) return
    const attempt = ++request.current
    const applies = () => active(row, life) && request.current === attempt
    setChecking(true)
    setExpiredProof(undefined)
    try {
      await identity(life)
      if (!applies()) return
      const response = await api.lookup(admission.binding, orgId, row.operationId, life.signal)
      await identity(life)
      if (!applies()) return
      if (response.state === 'committed') committed(row)
      else setExpiredProof(response.expiredUnrecorded ? { row, life, attempt } : undefined)
    } catch (failure) {
      if (applies()) setError(failure)
    } finally {
      if (request.current === attempt && lifetime.current === life && !life.signal.aborted)
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
  return {
    record,
    expiredUnrecorded: !!record && hasExpiredProof(),
    acknowledgeExpired: () => {
      if (current.current && hasExpiredProof()) {
        save(undefined)
        setExpiredProof(undefined)
        setError(undefined)
      }
    },
    error,
    ready,
    retired,
    storageAvailable,
    retryAt,
    mutation: { ...mutation, confirm },
    submit,
    check,
    busy:
      checking ||
      mutation.isSubmitting ||
      mutation.isSteppingUp ||
      mutation.stepUp.kind !== 'closed',
    clearError: () => setError(undefined),
  }
}
