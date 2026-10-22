import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'

import {
  type IntegrationItem,
  integrationItemSchema,
  type IntegrationsResponse,
} from '@amcore/shared'

import {
  INTEGRATION_REGISTRATIONS,
  type IntegrationProbePort,
  type IntegrationReader,
  type IntegrationReading,
  type IntegrationRegistration,
} from './integration.types.js'
import { validateRegistrations } from './integration-validation.js'

export const INTEGRATION_READ_DEADLINE_MS = 1500

interface Resolved {
  registration: IntegrationRegistration
  reader: IntegrationReader
  probe: IntegrationProbePort | null
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

/**
 * The single place that turns registrations into the Console response. Readers run concurrently
 * under a deadline, one read per reader in flight (a concurrent request joins it), and one failing
 * reader never hides the others.
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
   * resolution to the declared module, so each instance is checked against its declared class.
   */
  onApplicationBootstrap(): void {
    this.resolved = this.registrations.map((registration) => {
      const reader = this.moduleRef.get(registration.reader, { strict: false })
      if (!(reader instanceof registration.reader) || typeof reader.read !== 'function')
        throw new Error(`Integration reader does not match its registration: ${registration.id}`)
      let probe: IntegrationProbePort | null = null
      if (registration.probe) {
        probe = this.moduleRef.get(registration.probe.port, { strict: false })
        if (!(probe instanceof registration.probe.port))
          throw new Error(`Integration probe does not match its registration: ${registration.id}`)
      }
      return { registration, reader, probe }
    })
  }

  probe(id: string): IntegrationProbePort | null {
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
    let timer: NodeJS.Timeout | undefined
    try {
      const reading = await Promise.race([
        this.readOnce(entry),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('deadline')), INTEGRATION_READ_DEADLINE_MS)
        }),
      ])
      const action = entry.probe ? await entry.probe.action(actorId).catch(() => null) : null
      return integrationItemSchema.parse({
        id,
        name,
        source: 'ok',
        ...reading,
        action,
      })
    } catch {
      return { id, name, ...UNREADABLE, action: null }
    } finally {
      clearTimeout(timer)
    }
  }

  async list(actorId: string): Promise<IntegrationsResponse> {
    const items = await Promise.all(this.resolved.map((entry) => this.item(entry, actorId)))
    return { readAt: new Date().toISOString(), items }
  }
}
