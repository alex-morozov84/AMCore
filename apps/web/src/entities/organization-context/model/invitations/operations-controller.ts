import { createInvitationOperationId, type InviteResponse, type RevokeInviteResponse } from '@amcore/shared'

import { invitationsClient } from '../../api/invitations-client'
import type { AuthorityRefreshResult, OrganizationAccessController } from '../access-controller'

import { createInvitationManagerJournal,   type InvitationManagerCommand, invitationManagerCommandSchema, type InvitationManagerJournalRecord,managerOperationExpired } from './operation-journal'

const REJECTIONS = new Set(['BAD_REQUEST', 'VALIDATION_ERROR', 'FORBIDDEN', 'UNAUTHORIZED',
  'AUTH_ORIGIN_REJECTED', 'CONTEXT_SESSION_CHANGED', 'RATE_LIMIT_EXCEEDED', 'PAYLOAD_TOO_LARGE',
  'INVITE_GENERATION_CONFLICT', 'INVITE_ROLE_INTENT_INVALID', 'INVITE_INVALID_OR_EXPIRED',
  'INVITE_OPERATION_CONFLICT', 'INVITE_OPERATION_EXPIRED', 'INVITE_ALREADY_PENDING', 'INVITE_SETTLED'])
type Result = InviteResponse | RevokeInviteResponse
type State = { status: 'idle' | 'pending' | 'unknown' | 'expired' | 'committed' | 'rejected' | 'retired';
  record: InvitationManagerJournalRecord | null; persistent: boolean; error?: unknown;
  retryAt?: number; result?: Result; followup?: AuthorityRefreshResult }

/** Operation recovery outlives a dialog and query change, but never a changed session/organization. */
export function createInvitationManagerOperations(access: OrganizationAccessController,
  transport = invitationsClient, journal = createInvitationManagerJournal()) {
  const organizationId = access.organizationId
  let record = journal.read(access.binding, organizationId)
  let state: State = { status: record ? managerOperationExpired(record) ? 'expired' : 'unknown' : 'idle', record, persistent: true }
  if (record && state.status === 'expired') journal.clear(record)
  const serverState: State = { status: 'idle', record: null, persistent: true }
  let beforeRetire: State | undefined
  let active = true
  let epoch = 0
  const listeners = new Set<() => void>()
  const publish = (next: State) => { state = next; listeners.forEach(f => f()) }
  const current = (captured: number) => active && epoch === captured && access.organizationId === organizationId
  const execute = (saved: InvitationManagerJournalRecord, signal: AbortSignal) => {
    const c = saved.command
    if (c.kind === 'create') return transport.create(access.binding, organizationId, saved.operationId, c.input, signal)
    if (c.kind === 'reissue') return transport.reissue(access.binding, organizationId, c.inviteId, saved.operationId, c.input, signal)
    return transport.revoke(access.binding, organizationId, c.inviteId, saved.operationId, c.input.expectedGeneration, signal)
  }
  async function run(recovery: boolean, command?: InvitationManagerCommand) {
    if (!active || state.status === 'pending' || !access.allowed() || (state.retryAt !== undefined && state.retryAt > Date.now())) return
    if (!recovery && ['unknown', 'expired'].includes(state.status)) return
    const captured = epoch
    const authorityEpoch = access.capture()
    if (!recovery) {
      if (!command) return
      record = { binding: access.binding, organizationId, operationId: createInvitationOperationId(),
        command: invitationManagerCommandSchema.parse(command) }
      const persistent = journal.write(record)
      const previous = !persistent ? journal.read(access.binding, organizationId) : null
      if (previous) { record = previous; publish({ status: 'unknown', record, persistent: true }); return }
      publish({ status: 'pending', record, persistent })
    } else {
      if (!record) return
      publish({ ...state, status: 'pending', error: undefined })
    }
    const saved = record!
    const outcome = await access.execute<Result>('invitation-operation', async signal => {
      if (recovery) {
        const receipt = await transport.receipt(access.binding, organizationId, saved.operationId, signal)
        if (receipt.state === 'committed') {
          if (receipt.kind !== saved.command.kind) throw new Error('INVITE_OPERATION_CONFLICT')
          return receipt.result
        }
        if (managerOperationExpired(saved)) throw new Error('INVITE_OPERATION_EXPIRED')
      }
      return execute(saved, signal)
    }, { timeoutMs: 15000, rejectionCodes: REJECTIONS })
    if (!current(captured) || !access.current(authorityEpoch)) {
      journal.clear(saved)
      active = false
      publish({ ...state, status: 'retired', result: undefined, error: undefined })
      return
    }
    if (outcome.status === 'committed') {
      journal.clear(saved)
      publish({ ...state, status: 'committed', result: outcome.result, followup: outcome.followup, error: undefined })
    } else if (outcome.status === 'unknown' || outcome.status === 'rejected') {
      const status = outcome.status === 'unknown' && managerOperationExpired(saved) ? 'expired' : outcome.status
      if (status !== 'unknown') journal.clear(saved)
      publish({ ...state, status, error: outcome.error, retryAt: outcome.retryAt })
    } else publish({ ...state, status: outcome.status === 'retired' ? 'retired' : 'unknown' })
    return state
  }
  return {
    getSnapshot: () => state, getServerSnapshot: () => serverState,
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f) } },
    submit: (command: InvitationManagerCommand) => run(false, command), recover: () => run(true),
    async review() {
      if (!active || state.status === 'pending' || state.status === 'unknown') return false
      const captured = epoch
      const authorityEpoch = access.capture()
      const status = await access.refresh()
      if (!current(captured) || !access.current(authorityEpoch) || status !== 'ready') return false
      if (record) journal.clear(record)
      record = null
      publish({ status: 'idle', record: null, persistent: true })
      return true
    },
    expire() {
      if (record && state.status === 'unknown' && managerOperationExpired(record)) { journal.clear(record); publish({ ...state, status: 'expired' }) }
    },
    retire() { if (!active) return; beforeRetire = state; active = false; epoch++; if (record) journal.clear(record); publish({ ...state, status: 'retired', result: undefined, error: undefined }) },
    resume() {
      active = true
      if (beforeRetire) {
        const status = beforeRetire.status === 'pending' ? 'unknown' : beforeRetire.status
        const persistent = record && status === 'unknown' ? journal.write(record) : beforeRetire.persistent
        publish({ ...beforeRetire, status, persistent })
        beforeRetire = undefined
      }
    },
  }
}
export type InvitationManagerOperations = ReturnType<typeof createInvitationManagerOperations>
