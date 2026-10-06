import type { ReplaceMemberRolesResponse } from '@amcore/shared'

import { getErrorCode, getErrorStatus, getRetryAfterMs } from '@/shared/api/errors'
import { ApiRequestError } from '@/shared/api/http-client'
import { withDeadline } from '@/shared/lib/with-deadline'

export type AuthorityRefreshResult =
  'ready' | 'denied' | 'missing' | 'changed' | 'error' | 'retired'
export type OrganizationWriteOutcome<T> =
  | { status: 'committed'; result: T; followup: AuthorityRefreshResult }
  | { status: 'rejected' | 'unknown'; error: unknown; retryAt?: number }
  | { status: 'busy' | 'retired' }
export type RoleWriteOutcome = OrganizationWriteOutcome<ReplaceMemberRolesResponse>

/** Per-parent controller; transport barriers and operation busy tokens are separate. */
export function createOrganizationAccessController(binding: string, organizationId: string) {
  let epoch = 0
  let active = true
  let allowed = false
  let refreshAuthority: (signal?: AbortSignal) => Promise<AuthorityRefreshResult> = async () =>
    'error'
  const pending = new Map<string, symbol>()
  const transports = new Set<Promise<void>>()
  const readers = new Set<(signal?: AbortSignal) => Promise<unknown>>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((f) => f())
  const current = (captured: number) => active && captured === epoch
  const controller = {
    binding,
    get organizationId() {
      return organizationId
    },
    setTarget(next: string) {
      if (next !== organizationId) {
        epoch++
        allowed = false
        organizationId = next
        notify()
      }
    },
    capture: () => epoch,
    current,
    allowed: () => active && allowed,
    subscribe(f: () => void) {
      listeners.add(f)
      return () => {
        listeners.delete(f)
      }
    },
    isBusy: (memberId?: string) =>
      memberId
        ? pending.has(JSON.stringify([binding, organizationId, memberId]))
        : pending.size > 0,
    setAuthority(ready: boolean) {
      if (allowed !== ready) {
        allowed = ready
        notify()
      }
    },
    setRefresh(work: (signal?: AbortSignal) => Promise<AuthorityRefreshResult>) {
      refreshAuthority = work
    },
    registerRead(work: (signal?: AbortSignal) => Promise<unknown>) {
      readers.add(work)
      return () => {
        readers.delete(work)
      }
    },
    async waitTransports() {
      while (transports.size) await Promise.all([...transports])
    },
    async refresh(signal?: AbortSignal): Promise<AuthorityRefreshResult> {
      const captured = epoch
      signal?.throwIfAborted()
      const status = await refreshAuthority(signal)
      signal?.throwIfAborted()
      if (!current(captured)) return 'retired'
      if (status === 'ready') await Promise.all([...readers].map((f) => f(signal)))
      return status
    },
    retire() {
      epoch++
      active = false
      allowed = false
      notify()
    },
    resume() {
      active = true
    },
    async save(memberId: string, work: (signal: AbortSignal) => Promise<ReplaceMemberRolesResponse>): Promise<RoleWriteOutcome> {
      return controller.execute(memberId, work)
    },
    async execute<T>(
      memberId: string,
      work: (signal: AbortSignal) => Promise<T>,
      options?: { timeoutMs?: number; rejectionCodes?: ReadonlySet<string> }
    ): Promise<OrganizationWriteOutcome<T>> {
      if (!active) return { status: 'retired' }
      const pendingKey = JSON.stringify([binding, organizationId, memberId])
      if (pending.has(pendingKey)) return { status: 'busy' }
      if (!allowed) return { status: 'rejected', error: new Error('FORBIDDEN') }
      const captured = epoch
      const token = Symbol(memberId)
      pending.set(pendingKey, token)
      notify()
      let release!: () => void
      const transportDone = new Promise<void>((resolve) => {
        release = resolve
      })
      transports.add(transportDone)
      let result: T | undefined
      let error: unknown
      try {
        const abort = new AbortController()
        result = await withDeadline(work(abort.signal), options?.timeoutMs ?? 5000, abort)
      } catch (e) {
        error = e
      } finally {
        transports.delete(transportDone)
        release()
      }
      try {
        if (!current(captured)) return { status: 'retired' }
        let followup: AuthorityRefreshResult
        const followupAbort = new AbortController()
        try {
          followup = await withDeadline(
            controller.refresh(followupAbort.signal),
            5000,
            followupAbort
          )
        } catch {
          if (!current(captured)) return { status: 'retired' }
          followup = 'error'
          allowed = false
          notify()
        }
        if (!current(captured)) return { status: 'retired' }
        if (result) return { status: 'committed', result, followup }
        const status = getErrorStatus(error)
        const code = getErrorCode(error)
        const rejectionCodes = options?.rejectionCodes ?? new Set([
          'MEMBER_UNAVAILABLE',
          'MEMBER_ROLES_CONFLICT',
          'MEMBER_ROLE_ASSIGNMENT_DENIED',
          'ORGANIZATION_LAST_ADMIN',
          'BAD_REQUEST',
          'VALIDATION_ERROR',
          'FORBIDDEN',
          'UNAUTHORIZED',
          'AUTH_ORIGIN_REJECTED',
          'CONTEXT_SESSION_CHANGED',
          'RATE_LIMIT_EXCEEDED',
          'PAYLOAD_TOO_LARGE',
        ])
        const rejected =
          error instanceof ApiRequestError &&
          status !== undefined &&
          status >= 400 &&
          status < 500 &&
          code !== undefined &&
          rejectionCodes.has(code)
        return {
          status: rejected ? 'rejected' : 'unknown',
          error,
          retryAt: getRetryAfterMs(error) ? Date.now() + getRetryAfterMs(error)! : undefined,
        }
      } finally {
        if (pending.get(pendingKey) === token) {
          pending.delete(pendingKey)
          notify()
        }
      }
    },
  }
  return controller
}
export type OrganizationAccessController = ReturnType<typeof createOrganizationAccessController>
