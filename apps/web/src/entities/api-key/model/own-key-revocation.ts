import { getErrorStatus } from '@/shared/api/errors'

import type { OwnKeySession } from './session-lifecycle'

export interface OwnKeyIdentity {
  name?: string
  organizationName?: string | null
}
export interface OwnKeyRevocation extends OwnKeyIdentity {
  phase: 'idle' | 'pending' | 'confirmed' | 'unknown' | 'refused'
  keyId?: string
  refusal?: 'verification' | 'request'
  error?: unknown
}
type DeleteKey = (binding: string, id: string, signal: AbortSignal) => Promise<{ revoked: true }>

/** DELETE belongs to an actor/operation, independently of the creation target. */
export class OwnKeyRevocations {
  private state: OwnKeyRevocation = { phase: 'idle' }
  private generation = 0
  private dispatched = false
  constructor(
    private readonly session: OwnKeySession,
    private readonly binding: string,
    private readonly remove: DeleteKey,
    private readonly emit: () => void
  ) {}
  getSnapshot = () => this.state
  private publish(state: OwnKeyRevocation) {
    this.state = state
    this.emit()
  }
  retire() {
    this.generation++
    this.publish({ phase: 'idle' })
  }
  discard() {
    if (this.state.phase !== 'pending') return
    if (this.dispatched) this.publish({ ...this.state, phase: 'unknown' })
    else {
      this.generation++
      this.publish({ ...this.state, phase: 'refused', refusal: 'verification' })
    }
  }
  async revoke(id: string, identity?: OwnKeyIdentity) {
    if (this.state.phase === 'pending' || this.session.getSnapshot() === 'retired') return false
    const operation = ++this.generation
    const owns = () => operation === this.generation && this.session.getSnapshot() !== 'retired'
    const target = {
      keyId: id,
      ...(identity?.name !== undefined && { name: identity.name }),
      ...(identity?.organizationName !== undefined && {
        organizationName: identity.organizationName,
      }),
    }
    this.dispatched = false
    this.publish({ ...target, phase: 'pending' })
    try {
      if (!(await this.session.freshCheck())) {
        if (owns()) this.publish({ ...target, phase: 'refused', refusal: 'verification' })
        return false
      }
      if (!owns()) return false
      this.dispatched = true
      await this.remove(this.binding, id, new AbortController().signal)
      if (!owns()) return false
      this.publish({ ...target, phase: 'confirmed' })
      return true
    } catch (error) {
      if (!owns()) return false
      const status = getErrorStatus(error)
      if (status === 401 || status === 409) this.session.retire()
      else {
        const refused =
          !this.dispatched || [400, 403, 404, 413, 415, 422, 429].includes(status ?? 0)
        this.publish({
          ...target,
          phase: refused ? 'refused' : 'unknown',
          ...(refused && {
            refusal: this.dispatched ? ('request' as const) : ('verification' as const),
          }),
          error,
        })
      }
      throw error
    }
  }
}
