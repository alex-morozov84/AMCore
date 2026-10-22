import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'

import {
  type IntegrationItem,
  integrationItemSchema,
  type IntegrationsResponse,
} from '@amcore/shared'

import {
  INTEGRATION_REGISTRATIONS,
  type IntegrationProbePolicy,
  type IntegrationProbePort,
  type IntegrationReader,
  type IntegrationReading,
  type IntegrationRegistration,
} from './integration.types.js'
import { validateRegistrations } from './integration-validation.js'

export const INTEGRATION_READ_DEADLINE_MS = 1500

const PORT_METHODS = ['action', 'prepare', 'run', 'receiptFor'] as const

interface Resolved {
  registration: IntegrationRegistration
  reader: IntegrationReader
  probe: { port: IntegrationProbePort; policy: IntegrationProbePolicy } | null
}

const UNREADABLE: Omit<IntegrationItem, 'id' | 'name' | 'action'> = {
  configuration: 'not_configured',
  source: 'unavailable',
  evidence: {
    result: 'none',
    freshness: 'none',
    scope: 'configuration_only',
    instance: 'answering_instance',
    checkedAt: null,
    staleAfterSeconds: null,
    failure: null,
  },
  facts: [],
  links: [],
}

/** Rejects when `work` does not settle before `deadlineAt`; the work itself is not cancelled. */
function within<T>(work: Promise<T>, deadlineAt: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('deadline')), Math.max(0, deadlineAt - Date.now()))
  })
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer))
}

/**
 * The single place that turns registrations into the Console response. Readers run concurrently
 * under a deadline, one read per reader in flight (a concurrent request joins it), and one failing
 * reader never hides the others. The deadline covers the whole row, including its probe action.
 */
@Injectable()
export class IntegrationRegistry implements OnApplicationBootstrap {
  private resolved: Resolved[] = []
  private readonly inflight = new Map<string, Promise<IntegrationReading>>()

  constructor(
    @Inject(INTEGRATION_REGISTRATIONS)
    private readonly registrations: readonly IntegrationRegistration[],
    private readonly moduleRef: ModuleRef
  ) {
    validateRegistrations(registrations)
  }

  /**
   * Ports are resolved after all modules initialised. A global token lookup does not restrict
   * resolution to the declared module, so each instance is checked against its declared class
   * and against the methods the Console calls.
   */
  onApplicationBootstrap(): void {
    this.resolved = this.registrations.map((registration) => {
      const reader = this.moduleRef.get(registration.reader, { strict: false })
      if (!(reader instanceof registration.reader) || typeof reader.read !== 'function')
        throw new Error(`Integration reader does not match its registration: ${registration.id}`)
      let probe: Resolved['probe'] = null
      if (registration.probe) {
        const port = this.moduleRef.get(registration.probe.port, { strict: false })
        if (
          !(port instanceof registration.probe.port) ||
          PORT_METHODS.some((method) => typeof port[method] !== 'function')
        )
          throw new Error(`Integration probe does not match its registration: ${registration.id}`)
        probe = { port, policy: registration.probe.policy }
      }
      return { registration, reader, probe }
    })
  }

  /** The registered port and the registered policy that the Console must hand to it. */
  probe(id: string): NonNullable<Resolved['probe']> | null {
    return this.resolved.find((entry) => entry.registration.id === id)?.probe ?? null
  }

  private readOnce(entry: Resolved): Promise<IntegrationReading> {
    const existing = this.inflight.get(entry.registration.id)
    if (existing) return existing
    const controller = new AbortController()
    const started = Promise.resolve()
      .then(() => entry.reader.read(controller.signal))
      .finally(() => this.inflight.delete(entry.registration.id))
    this.inflight.set(entry.registration.id, started)
    // The physical read keeps its slot until it settles; only this caller's wait is bounded.
    started.catch(() => undefined)
    setTimeout(() => controller.abort(), INTEGRATION_READ_DEADLINE_MS).unref()
    return started
  }

  private async item(entry: Resolved, actorId: string): Promise<IntegrationItem> {
    const { id, name } = entry.registration
    const deadlineAt = Date.now() + INTEGRATION_READ_DEADLINE_MS
    try {
      const reading = await within(this.readOnce(entry), deadlineAt)
      // A slow or failing action costs the button, never the row or the neighbouring rows.
      const action = entry.probe
        ? await within(entry.probe.port.action(actorId), deadlineAt).catch(() => null)
        : null
      return integrationItemSchema.parse({ id, name, source: 'ok', ...reading, action })
    } catch {
      return { id, name, ...UNREADABLE, action: null }
    }
  }

  async list(actorId: string): Promise<IntegrationsResponse> {
    const items = await Promise.all(this.resolved.map((entry) => this.item(entry, actorId)))
    return { readAt: new Date().toISOString(), items }
  }
}
