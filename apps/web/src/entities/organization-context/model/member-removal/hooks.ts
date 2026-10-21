import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MemberRemovalResult } from '@amcore/shared'

import { getErrorCode, getErrorStatus, getRetryAfterMs } from '@/shared/api/errors'
import { withDeadline } from '@/shared/lib/with-deadline'

import { memberRemovalRejectionCodes, removeMember } from '../../api/member-removal-client'
import { membersClient } from '../../api/members-client'
import type { OrganizationAccessController, OrganizationWriteOutcome } from '../access-controller'

import 'client-only'

export interface MemberRemovalTarget {
  userId: string
  memberId: string
  name?: string | null
  email: string
  organizationName?: string
}
export type RemovalInspection =
  | { status: 'same' | 'different'; memberId: string }
  | { status: 'unavailable' | 'denied' }
  | { status: 'error'; error: unknown }

/** State outlives confirmation/list rows, but never its actor/organization owner. */
export function useMemberRemoval(
  controller: OrganizationAccessController,
  target?: MemberRemovalTarget,
  onAcknowledged?: () => void
) {
  const orgId = controller.organizationId
  const identity = JSON.stringify([controller.binding, orgId, target?.userId, target?.memberId])
  const lease = useRef<string | undefined>(identity)
  useEffect(() => {
    lease.current = identity
    return () => {
      lease.current = undefined
    }
  }, [identity])
  const [outcome, setOutcome] = useState<OrganizationWriteOutcome<MemberRemovalResult>>()
  const [inspection, setInspection] = useState<RemovalInspection>()
  const [pending, setPending] = useState(false)
  const [checking, setChecking] = useState(false)
  const [retryAt, setRetryAt] = useState<number>()
  const cooldown = useRef(0)
  const delayRecovery = (deadline?: number) => {
    cooldown.current = deadline ?? 0
    setRetryAt(deadline)
  }
  useEffect(() => {
    if (!retryAt) return
    const timer = setTimeout(
      () => {
        if (lease.current === identity) setRetryAt(undefined)
      },
      Math.max(0, retryAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [retryAt, identity])
  useEffect(() => {
    setOutcome(undefined)
    setInspection(undefined)
    setPending(false)
    setChecking(false)
    delayRecovery()
  }, [identity])
  const operation = useRef(false)
  const inspectionRun = useRef(false)
  const busy = useSyncExternalStore(
    controller.subscribe,
    () => controller.isBusy(),
    () => false
  )
  const canRemove = Boolean(
    target &&
    controller.allowed() &&
    !pending &&
    !checking &&
    !busy &&
    (!retryAt || Date.now() >= retryAt) &&
    outcome?.status !== 'committed' &&
    (outcome?.status !== 'unknown' || inspection?.status === 'same') &&
    (!inspection || inspection.status === 'same') &&
    (!outcome || !('retryAt' in outcome) || !outcome.retryAt || Date.now() >= outcome.retryAt)
  )

  const remove = async () => {
    if (
      !target ||
      !canRemove ||
      operation.current ||
      lease.current !== identity ||
      Date.now() < cooldown.current
    )
      return
    operation.current = true
    const epoch = controller.capture()
    setPending(true)
    setInspection(undefined)
    try {
      const result = await controller.execute(
        target.memberId,
        async (signal) => {
          const result = await removeMember(
            controller.binding,
            orgId,
            target.userId,
            target.memberId,
            signal
          )
          // Preserve confirmed self-removal feedback before the authority refresh denies access.
          if (lease.current === identity && controller.current(epoch)) onAcknowledged?.()
          return result
        },
        { timeoutMs: 20000, rejectionCodes: memberRemovalRejectionCodes }
      )
      if (lease.current !== identity || !controller.current(epoch))
        return { status: 'retired' as const }
      if (result.status === 'retired' || result.status === 'busy') return result
      delayRecovery('retryAt' in result ? result.retryAt : undefined)
      setOutcome(result)
      return result
    } finally {
      operation.current = false
      if (lease.current === identity) setPending(false)
    }
  }
  const inspect = async () => {
    if (
      !target ||
      pending ||
      inspectionRun.current ||
      busy ||
      lease.current !== identity ||
      Date.now() < cooldown.current
    )
      return
    if (outcome && 'retryAt' in outcome && outcome.retryAt && Date.now() < outcome.retryAt) return
    inspectionRun.current = true
    setChecking(true)
    const epoch = controller.capture()
    const abort = new AbortController()
    const current = () => lease.current === identity && controller.current(epoch)
    try {
      const authority = await withDeadline(controller.refresh(abort.signal), 5000, abort)
      if (!current()) return
      if (authority !== 'ready') {
        setInspection(
          authority === 'denied'
            ? { status: 'denied' }
            : { status: 'error', error: new Error('MEMBER_READ_UNAVAILABLE') }
        )
        return
      }
      const result = await withDeadline(
        membersClient.roles(
          controller.binding,
          orgId,
          target.userId,
          { page: 1, search: '', section: 'assigned' },
          abort.signal
        ),
        20000,
        abort
      )
      if (current())
        setInspection({
          status: result.member.memberId === target.memberId ? 'same' : 'different',
          memberId: result.member.memberId,
        })
    } catch (error) {
      if (!current()) return
      const delay = getRetryAfterMs(error)
      delayRecovery(delay ? Date.now() + delay : undefined)
      setInspection(
        getErrorStatus(error) === 403
          ? { status: 'denied' }
          : getErrorStatus(error) === 404 && getErrorCode(error) === 'MEMBER_UNAVAILABLE'
            ? { status: 'unavailable' }
            : { status: 'error', error }
      )
    } finally {
      inspectionRun.current = false
      if (lease.current === identity) setChecking(false)
    }
  }
  return { outcome, inspection, pending, checking, busy, retryAt, canRemove, remove, inspect }
}
