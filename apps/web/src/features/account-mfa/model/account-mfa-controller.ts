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
  inspect(operationId?: string): Promise<MfaBrowserView>
  command(input: MfaBrowserCommand): Promise<MfaBrowserResult>
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
  private listeners = new Set<() => void>()
  constructor(private readonly adapter: AccountMfaAdapter) {}
  getSnapshot = () => this.state
  getSecrets = () => this.secrets
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
      const view = mfaBrowserViewSchema.parse(await this.adapter.inspect(operationId))
      if (generation === this.generation) this.update({ phase: 'ready', view })
    } catch (error) {
      if (generation === this.generation) this.fail(error, false)
    }
  }
  async command(input: Omit<MfaBrowserCommand, 'operationId'>) {
    if (this.state.phase !== 'ready') return
    const generation = ++this.generation
    const operationId = crypto.randomUUID()
    this.update({ ...this.state, phase: 'submitting', operationId, error: undefined })
    try {
      const result = mfaBrowserResultSchema.parse(
        await this.adapter.command({ ...input, operationId })
      )
      if (generation !== this.generation) return
      this.secrets = { enrollment: result.enrollment, backupCodes: result.backupCodes }
      this.update({ phase: 'ready', view: result.view })
    } catch (error) {
      if (generation === this.generation) this.fail(error, true)
    }
  }
  private fail(error: unknown, mutation: boolean) {
    const status = getErrorStatus(error)
    if (status === 401 || status === 409) {
      this.secrets = {}
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
