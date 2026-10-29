import {
  type MfaBrowserCommand,
  type MfaBrowserResult,
  mfaBrowserResultSchema,
  type MfaBrowserView,
  mfaBrowserViewSchema,
} from '@amcore/shared'

import { ClientErrorCode, ClientStateError } from '@/shared/api/error-codes'
import { getErrorCode, getErrorStatus, getRetryAfterMs } from '@/shared/api/errors'
import { ApiRequestError } from '@/shared/api/http-client'

export interface AccountMfaAdapter {
  recoveryScope?: string
  inspect(operationId?: string, flowBinding?: string): Promise<MfaBrowserView>
  command(input: MfaBrowserCommand): Promise<MfaBrowserResult>
  resolveStart?(
    operationId: string,
    purpose: 'rotate_codes' | 'replace_factor'
  ): Promise<MfaBrowserResult>
}
export interface AccountMfaSnapshot {
  phase: 'loading' | 'ready' | 'submitting' | 'unknown' | 'unavailable' | 'changed'
  view?: MfaBrowserView
  operationId?: string
  error?: unknown
}
type Secrets = Pick<MfaBrowserResult, 'enrollment' | 'backupCodes'>

/** Owns transient secrets outside the serializable state. No query cache or persistence. */
export class AccountMfaController {
  private state: AccountMfaSnapshot = { phase: 'loading' }
  private secrets: Secrets = {}
  private generation = 0
  private flowBinding?: string
  private sessionIntent?: string
  private startPurpose?: 'rotate_codes' | 'replace_factor'
  private recoveryExpiry = Date.now() + 300000
  private settlements = 0
  private settlementStarted = 0
  private listeners = new Set<() => void>()
  constructor(private readonly adapter: AccountMfaAdapter) {}
  getSnapshot = () => this.state
  getSecrets = () => this.secrets
  getFlowBinding = () => this.flowBinding
  getSessionIntent = () => this.sessionIntent
  getRecoveryScope = () => this.adapter.recoveryScope
  getRecoveryReference = () =>
    this.flowBinding || this.state.operationId
      ? {
          flowBinding: this.flowBinding,
          operationId: this.state.operationId,
          startPurpose: this.startPurpose,
          expiresAt: this.recoveryExpiry,
        }
      : undefined
  restoreReference(reference: {
    flowBinding?: string
    operationId?: string
    startPurpose?: 'rotate_codes' | 'replace_factor'
    expiresAt: number
  }) {
    if (this.state.phase !== 'loading' || reference.expiresAt <= Date.now()) return
    this.flowBinding = reference.flowBinding
    this.startPurpose = reference.startPurpose
    this.recoveryExpiry = reference.expiresAt
    this.state = { phase: 'loading', operationId: reference.operationId }
  }
  resetToSettings() {
    this.generation++
    this.flowBinding = undefined
    this.startPurpose = undefined
    this.secrets = {}
    this.update({ phase: 'loading' })
    return this.inspect()
  }
  forgetCompleted() {
    const view = this.state.view
    if (!(view?.kind === 'settings_start' || (view?.kind === 'flow' && view.state === 'completed')))
      return
    this.flowBinding = undefined
    this.startPurpose = undefined
    this.secrets = {}
    this.update({ phase: 'loading' })
  }
  async reconcile() {
    this.settlements = 0
    this.settlementStarted = Date.now()
    if (
      this.flowBinding &&
      this.state.view?.kind === 'flow' &&
      ['login', 'initial_setup'].includes(this.state.view.purpose)
    ) {
      this.state = { ...this.state, phase: 'ready' }
      return this.command({ action: 'reconcile_login' })
    }
    return this.inspect()
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(next: AccountMfaSnapshot) {
    this.state = next
    this.listeners.forEach((listener) => listener())
  }
  conceal = () => {
    this.generation++
    this.secrets = {}
    this.update({ phase: 'loading', operationId: this.state.operationId })
  }
  async inspect() {
    const generation = ++this.generation
    const operationId = this.state.operationId
    this.secrets = {}
    this.update({ phase: 'loading', operationId })
    try {
      const recovered =
        this.startPurpose && operationId && !this.flowBinding && this.adapter.resolveStart
          ? await this.adapter.resolveStart(operationId, this.startPurpose)
          : undefined
      const view = mfaBrowserViewSchema.parse(
        recovered
          ? recovered.view
          : await (this.flowBinding
              ? this.adapter.inspect(undefined, this.flowBinding)
              : this.adapter.inspect(operationId))
      )
      if (generation === this.generation) {
        this.retainFlowBinding(view)
        this.update({ phase: 'ready', view })
      }
    } catch (error) {
      if (generation === this.generation) this.fail(error, false)
    }
  }
  async command(input: Omit<MfaBrowserCommand, 'operationId' | 'flowBinding'>) {
    if (this.state.phase !== 'ready') return
    const generation = ++this.generation
    if (input.action === 'settle_login' || input.action === 'reconcile_login') {
      if (!this.settlementStarted) this.settlementStarted = Date.now()
      if (++this.settlements > 3 || Date.now() - this.settlementStarted > 20000) {
        this.update({ ...this.state, phase: 'unknown' })
        return
      }
    }
    const operationId = crypto.randomUUID()
    if (input.action === 'start_code_rotation' || input.action === 'start_replacement') {
      this.startPurpose = input.action === 'start_replacement' ? 'replace_factor' : 'rotate_codes'
      this.recoveryExpiry = Date.now() + (this.startPurpose === 'replace_factor' ? 900000 : 300000)
    }
    this.update({ ...this.state, phase: 'submitting', operationId, error: undefined })
    try {
      const result = mfaBrowserResultSchema.parse(
        await this.adapter.command({
          ...input,
          operationId,
          ...(this.flowBinding ? { flowBinding: this.flowBinding } : {}),
        })
      )
      if (generation !== this.generation) return
      this.retainFlowBinding(result.view)
      this.secrets = { enrollment: result.enrollment, backupCodes: result.backupCodes }
      this.update({ phase: 'ready', view: result.view })
    } catch (error) {
      if (generation === this.generation) this.fail(error, true)
    }
  }
  private retainFlowBinding(view: MfaBrowserView) {
    if (view.kind === 'settings') this.sessionIntent = view.contextSession
    const binding = 'flowBinding' in view ? view.flowBinding : undefined
    if (this.flowBinding && this.flowBinding !== binding) throw new ApiRequestError(401, undefined)
    if (binding) this.flowBinding = binding
    if (view.kind === 'flow') this.recoveryExpiry = Date.parse(view.expiresAt)
  }
  private fail(error: unknown, mutation: boolean) {
    const status = getErrorStatus(error)
    if (status === 401 || status === 409) {
      this.secrets = {}
      this.flowBinding = undefined
      this.startPurpose = undefined
      this.update({ phase: 'changed' })
      return
    }
    // Retain only safe diagnostics; never keep a raw response/cause containing secret input.
    const safeError = status
      ? new ApiRequestError(
          status,
          {
            statusCode: status,
            message: 'MFA request failed',
            errorCode: getErrorCode(error),
            timestamp: '',
            path: '',
            method: '',
          },
          (getRetryAfterMs(error) ?? 0) / 1000
        )
      : new ClientStateError(ClientErrorCode.UNKNOWN_ERROR)
    const refused = status !== undefined && [400, 403, 404, 422, 429].includes(status)
    if (mutation && !refused) {
      this.secrets = {}
      this.update({ ...this.state, phase: 'unknown', error: safeError })
    } else {
      this.update({ ...this.state, phase: mutation ? 'ready' : 'unavailable', error: safeError })
    }
  }
}
