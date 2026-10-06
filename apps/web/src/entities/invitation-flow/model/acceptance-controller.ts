import {
  type AcceptInviteResponse,
  createInvitationOperationId,
  type InvitationFlowBinding,
} from '@amcore/shared'

import { ClientErrorCode, ClientStateError } from '@/shared/api/error-codes'
import { withDeadline } from '@/shared/lib/with-deadline'

import { invitationFlowClient } from '../api/flow-client'

import { createInvitationAcceptJournal, type InvitationAcceptDescriptor } from './accept-journal'

type State = {
  status: 'idle' | 'pending' | 'unknown' | 'committed' | 'access_removed' | 'retired'
  descriptor: InvitationAcceptDescriptor | null
  persistent: boolean
  result?: AcceptInviteResponse
  error?: unknown
}
type Intent = Pick<InvitationAcceptDescriptor, 'expectedInviteId' | 'expectedGeneration'>
const changed = () => new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)
const sameIntent = (left: Intent, right: Intent) =>
  left.expectedInviteId === right.expectedInviteId &&
  left.expectedGeneration === right.expectedGeneration

/** Single explicit consent operation per mounted flow; storage failure keeps an in-memory journal. */
export function createInvitationAcceptanceController(
  binding: InvitationFlowBinding,
  intent: Intent,
  transport: Pick<typeof invitationFlowClient, 'accept' | 'recover'> = invitationFlowClient,
  journal = createInvitationAcceptJournal()
) {
  let active = true
  let epoch = 0
  let descriptor = journal.read(binding.flowId)
  let state: State = { status: descriptor ? 'unknown' : 'idle', descriptor, persistent: true }
  const serverState: State = { status: 'idle', descriptor: null, persistent: true }
  const listeners = new Set<() => void>()
  const publish = (next: State) => {
    state = next
    listeners.forEach((listener) => listener())
  }
  const current = (captured: number) => active && epoch === captured
  async function bounded<T>(work: (signal: AbortSignal) => Promise<T>) {
    const abort = new AbortController()
    return withDeadline(work(abort.signal), 15000, abort)
  }
  async function send(saved: InvitationAcceptDescriptor, captured: number) {
    const response = await bounded((signal) => transport.accept({ binding, ...saved }, signal))
    if (!current(captured)) return
    if (
      response.binding.flowId !== binding.flowId ||
      response.binding.flowRevision !== binding.flowRevision ||
      response.binding.sessionBinding !== binding.sessionBinding
    )
      throw changed()
    journal.clear(binding.flowId, saved.operationId)
    publish({ ...state, status: 'committed', result: response.data, error: undefined })
  }
  async function execute(recovery: boolean, canRetry: boolean) {
    if (
      !active ||
      state.status === 'pending' ||
      state.status === 'committed' ||
      state.status === 'access_removed'
    )
      return
    if (!recovery && state.status !== 'idle') return
    const captured = epoch
    if (!descriptor) {
      descriptor = { ...intent, operationId: createInvitationOperationId() }
      const persistent = journal.write(binding.flowId, descriptor)
      if (!persistent) {
        const existing = journal.read(binding.flowId)
        if (existing) {
          descriptor = existing
          publish({ status: 'unknown', descriptor, persistent: true, error: changed() })
          return
        }
      }
      publish({ status: 'pending', descriptor, persistent })
    } else publish({ ...state, status: 'pending', error: undefined })
    const saved = descriptor
    try {
      if (!sameIntent(saved, intent)) throw changed()
      if (recovery) {
        const receipt = await bounded((signal) => transport.recover(saved.operationId, signal))
        if (!current(captured)) return
        if (receipt.state === 'committed') {
          if (!sameIntent(receipt.intent, saved)) throw changed()
          journal.clear(binding.flowId, saved.operationId)
          publish({
            ...state,
            status: receipt.access === 'removed' ? 'access_removed' : 'committed',
            result: receipt.result,
            error: undefined,
          })
          return
        }
        // Unknown GET is not rollback proof. An explicit recovery may retry only this exact intent/ID.
        if (!canRetry) {
          publish({ ...state, status: 'unknown' })
          return
        }
      }
      await send(saved, captured)
    } catch (error) {
      if (!current(captured)) return
      // Even a late BFF binding conflict can follow an API commit. Never allocate a replacement ID here.
      publish({ ...state, status: 'unknown', error })
    }
  }
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => serverState,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    accept: () => execute(false, true),
    recover: (canRetry = false) => execute(true, canRetry),
    retire() {
      active = false
      epoch++
      publish({ ...state, status: 'retired', result: undefined, error: undefined })
    },
    resume() {
      active = true
      if (state.status === 'retired') publish({ ...state, status: descriptor ? 'unknown' : 'idle' })
    },
  }
}
export type InvitationAcceptanceController = ReturnType<typeof createInvitationAcceptanceController>
