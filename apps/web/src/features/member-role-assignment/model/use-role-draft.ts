import { useEffect, useRef, useState } from 'react'
import type { MemberRolesResponse, ReplaceMemberRoles } from '@amcore/shared'
import { replaceMemberRolesSchema } from '@amcore/shared'

import type {
  OrganizationAccessController,
  useMemberRoleAssignments,
} from '@/entities/organization-context'
import { useLocalizedForm } from '@/shared/hooks/use-localized-form'
import { withDeadline } from '@/shared/lib/with-deadline'

import 'client-only'

type Reads = ReturnType<typeof useMemberRoleAssignments>
const defaults = (snapshot: MemberRolesResponse): ReplaceMemberRoles => ({
  expectedMemberId: snapshot.member.memberId,
  expectedAclVersion: snapshot.aclVersion,
  roleIds: snapshot.assignedRoles?.map((role) => role.id) ?? [],
})

/** Unsaved selection is independent of search pages and automatic authority reads. */
export function useRoleDraft(
  initial: MemberRolesResponse,
  roles: Reads,
  controller: OrganizationAccessController,
  onComplete?: () => void
) {
  const [snapshot, setSnapshot] = useState(initial)
  const form = useLocalizedForm<ReplaceMemberRoles>(replaceMemberRolesSchema, {
    defaultValues: defaults(initial),
  })
  const selected = form.watch('roleIds')
  const original = snapshot.assignedRoles?.map((role) => role.id) ?? []
  const changed =
    selected.length !== original.length || selected.some((id) => !original.includes(id))
  const [ack, setAck] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'savedUnavailable' | 'unknown' | 'reviewFailed'>()
  const [error, setError] = useState<unknown>()
  const [needsReview, setNeedsReview] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [retryAt, setRetryAt] = useState<number>()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (retryAt === undefined) return
    const timer = setTimeout(() => setRetryAt(undefined), Math.max(0, retryAt - Date.now()))
    return () => clearTimeout(timer)
  }, [retryAt])
  const outdated = Boolean(
    roles.data &&
    (roles.data.aclVersion !== snapshot.aclVersion ||
      roles.data.member.memberId !== snapshot.member.memberId)
  )
  const epoch = controller.capture()
  const current = () => mounted.current && controller.current(epoch)
  async function submit(dto: ReplaceMemberRoles) {
    setError(undefined)
    setNotice(undefined)
    const outcome = await roles.save(dto)
    if (!current()) return
    if (outcome.status === 'committed') {
      if (outcome.followup === 'ready' && onComplete) {
        onComplete()
        return
      }
      setNotice(outcome.followup === 'ready' ? 'saved' : 'savedUnavailable')
      setNeedsReview(true)
    } else if (outcome.status === 'unknown' || outcome.status === 'rejected') {
      setRetryAt(outcome.retryAt)
      setNeedsReview(true)
      if (outcome.status === 'unknown') setNotice('unknown')
      else setError(outcome.error)
    }
  }
  async function review() {
    setReviewing(true)
    const abort = new AbortController()
    try {
      const fresh = await withDeadline(
        (async () => {
          const status = await controller.refresh(abort.signal)
          abort.signal.throwIfAborted()
          if (status !== 'ready') throw new Error('FORBIDDEN')
          return roles.refresh(abort.signal)
        })(),
        10000,
        abort
      )
      if (!fresh || !current()) return
      setSnapshot(fresh)
      form.reset(defaults(fresh))
      setAck(false)
      setNeedsReview(false)
      setNotice(undefined)
      setError(undefined)
    } catch (failure) {
      if (current()) {
        setError(failure)
        setNotice('reviewFailed')
      }
    } finally {
      if (current()) setReviewing(false)
    }
  }
  return {
    form,
    selected,
    changed,
    snapshot,
    ack,
    setAck,
    notice,
    error,
    needsReview: needsReview || outdated,
    outdated,
    reviewing,
    retryAt,
    submit,
    review,
  }
}
