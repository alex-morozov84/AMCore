import {
  type ApiKeyQuery,
  type CreateApiKeyInput,
  type OwnApiKeyAdmission,
  ownKeyCreateSchema,
  type OwnKeyOrganizationsQuery,
} from '@amcore/shared'

import { getErrorStatus } from '@/shared/api/errors'

import { ownApiKeysClient } from '../api/own-api-keys-client'

import { type OwnKeyIdentity, OwnKeyRevocations } from './own-key-revocation'

export type { OwnKeyRevocation } from './own-key-revocation'

import { OwnKeySession } from './session-lifecycle'

import 'client-only'

export interface OwnKeyAttempt {
  phase: 'idle' | 'preflight' | 'pending' | 'confirmed' | 'unknown' | 'createdSecretLost'
  localId?: string
  organizationName?: string
  input?: CreateApiKeyInput
  dispatchedAt?: number
  expiresAt?: string | null
  createdAt?: string
  keyId?: string
  inspectionCompleted: boolean
  error?: Error
}
const idle = (): OwnKeyAttempt => ({ phase: 'idle', inspectionCompleted: false })
type Client = Omit<typeof ownApiKeysClient, 'organizations'> &
  Partial<Pick<typeof ownApiKeysClient, 'organizations'>>

/** Actor-owned host. Its published journal holds safe metadata, never a creation response. */
export class OwnApiKeyController {
  readonly session: OwnKeySession
  private state = idle()
  private readonly revocations: OwnKeyRevocations
  getRevocationSnapshot = () => this.revocations.getSnapshot()
  private commandGeneration = 0
  private secret: string | undefined
  private target: string | undefined
  private listeners = new Set<() => void>()
  constructor(
    readonly admission: OwnApiKeyAdmission,
    private readonly client: Client = ownApiKeysClient
  ) {
    this.session = new OwnKeySession(() =>
      client.verify(admission.binding, new AbortController().signal)
    )
    this.revocations = new OwnKeyRevocations(
      this.session,
      admission.binding,
      client.revoke.bind(client),
      () => this.emit()
    )
    this.session.subscribe(() => {
      if (this.session.getSnapshot() === 'retired') {
        this.secret = undefined
        this.state = idle()
        this.revocations.retire()
      }
      this.emit()
    })
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.state
  private emit() {
    this.listeners.forEach((listener) => listener())
  }
  private update(next: OwnKeyAttempt) {
    this.state = next
    this.emit()
  }
  setTarget(target: string | undefined) {
    if (target !== this.target) {
      this.target = target
      this.secret = undefined
      this.session.invalidate()
      if (this.state.phase === 'preflight') this.update(idle())
      if (this.state.phase === 'confirmed')
        this.update({ ...this.state, phase: 'createdSecretLost' })
    }
  }
  active = () => this.state.phase === 'pending' || this.secret !== undefined
  discard = () => {
    this.commandGeneration++
    this.secret = undefined
    this.session.invalidate()
    this.revocations.discard()
    this.update(idle())
  }
  closeDraft() {
    if (this.state.phase === 'preflight') {
      this.commandGeneration++
      this.session.invalidate()
      this.update(idle())
      void this.session.freshCheck()
    }
  }
  secretForDisplay(expectedTarget = this.target) {
    if (expectedTarget !== this.target) return undefined
    return this.session.getSnapshot() === 'verified' &&
      document.visibilityState === 'visible' &&
      document.hasFocus()
      ? this.secret
      : undefined
  }
  private async authorizeCreate(
    localId: string,
    generation: number,
    epoch: number,
    verifyTarget?: () => Promise<boolean>
  ) {
    const owns = () =>
      this.commandGeneration === generation &&
      this.state.localId === localId &&
      this.state.phase === 'preflight' &&
      this.session.getSnapshot() !== 'retired'
    try {
      const verified = await this.session.freshCheck()
      if (!owns()) return false
      if (!verified || !this.session.current(epoch)) {
        this.update(idle())
        return false
      }
      const authorized = verifyTarget ? await verifyTarget() : true
      if (!owns()) return false
      if (!this.session.current(epoch)) {
        this.update(idle())
        return false
      }
      if (authorized) return true
    } catch {
      if (!owns()) return false
    }
    this.update({ ...idle(), error: new Error('OWN_KEY_AUTHORITY_UNAVAILABLE') })
    return false
  }
  async create(
    input: CreateApiKeyInput,
    organizationName?: string,
    verifyTarget?: () => Promise<boolean>
  ) {
    if (!['idle'].includes(this.state.phase)) return
    if (!ownKeyCreateSchema.safeParse(input).success) {
      this.update({ ...idle(), error: new Error('INVALID_KEY_INPUT') })
      return
    }
    const localId = crypto.randomUUID()
    const generation = this.commandGeneration
    const frozen = { ...input, scopes: [...input.scopes] }
    const epoch = this.session.capture()
    this.update({
      phase: 'preflight',
      localId,
      input: frozen,
      organizationName,
      inspectionCompleted: false,
    })
    if (!(await this.authorizeCreate(localId, generation, epoch, verifyTarget))) return
    this.update({
      phase: 'pending',
      localId,
      organizationName,
      input: frozen,
      dispatchedAt: Date.now(),
      inspectionCompleted: false,
    })
    // Begin observer sampling now, including while POST is in flight.
    this.session.conceal()
    try {
      const result = await this.client.create(
        this.admission.binding,
        frozen,
        new AbortController().signal
      )
      if (generation !== this.commandGeneration || this.session.getSnapshot() === 'retired') return
      if (!this.session.current(epoch) || this.target !== frozen.organizationId) {
        this.update({
          ...this.state,
          phase: 'createdSecretLost',
          keyId: result.id,
          expiresAt: result.expiresAt,
          createdAt: result.createdAt,
        })
        return
      }
      this.session.conceal()
      this.secret = result.key
      this.update({
        ...this.state,
        phase: 'confirmed',
        keyId: result.id,
        expiresAt: result.expiresAt,
        createdAt: result.createdAt,
      })
      this.session.conceal()
      await this.session.freshCheck()
    } catch (error) {
      if (generation !== this.commandGeneration || this.session.getSnapshot() === 'retired') return
      const status = getErrorStatus(error)
      if (status === 401 || status === 409) {
        this.session.retire()
        return
      }
      const refused = status !== undefined && [400, 403, 404, 413, 415, 422, 429].includes(status)
      this.update(
        refused
          ? { ...idle(), error: error as Error }
          : { ...this.state, phase: 'unknown', error: error as Error }
      )
    }
  }
  async organizations(query: OwnKeyOrganizationsQuery, signal: AbortSignal) {
    try {
      if (!this.client.organizations) throw new Error('ORGANIZATION_METADATA_UNAVAILABLE')
      const data = await this.client.organizations(this.admission.binding, query, signal)
      if (this.session.getSnapshot() === 'retired') throw new Error('CONTEXT_SESSION_CHANGED')
      return data
    } catch (error) {
      if ([401, 409].includes(getErrorStatus(error) ?? 0)) this.session.retire()
      throw error
    }
  }
  async list(query: ApiKeyQuery, signal: AbortSignal) {
    try {
      const result = await this.client.list(this.admission.binding, query, signal)
      if (this.session.getSnapshot() === 'retired') throw new Error('CONTEXT_SESSION_CHANGED')
      return result
    } catch (error) {
      if ([401, 409].includes(getErrorStatus(error) ?? 0)) this.session.retire()
      throw error
    }
  }
  async inspect() {
    const result = await this.list(
      { page: 1, limit: 20, status: 'all' },
      new AbortController().signal
    )
    if (this.state.phase === 'unknown') this.update({ ...this.state, inspectionCompleted: true })
    return result
  }
  dismissUnknown(acknowledged: boolean) {
    if (this.state.phase === 'unknown' && this.state.inspectionCompleted && acknowledged)
      this.update(idle())
  }
  acknowledgeSaved() {
    if (!['confirmed', 'createdSecretLost'].includes(this.state.phase)) return
    this.secret = undefined
    this.update(idle())
  }
  async copy() {
    return (await this.copyDetailed()) === 'copied'
  }
  async copyDetailed() {
    const epoch = this.session.capture()
    if (!(await this.session.freshCheck()) || !this.session.current(epoch))
      return 'unverified' as const
    const secret = this.secretForDisplay()
    if (!secret) return 'unverified' as const
    try {
      await navigator.clipboard.writeText(secret)
      return 'copied' as const
    } catch {
      return 'clipboardFailed' as const
    }
  }
  revoke(id: string, identity?: OwnKeyIdentity) {
    return this.revocations.revoke(id, identity)
  }
}
