import { INTEGRATION_PROBE_KINDS, INTEGRATIONS_MAX } from '@amcore/shared'

import type { IntegrationProbePolicy, IntegrationRegistration } from './integration.types.js'

const ID = /^[a-z][a-z0-9_]{0,31}$/

function validatePolicy(id: string, policy: IntegrationProbePolicy): void {
  const ok =
    Number.isInteger(policy.deadlineMs) &&
    policy.deadlineMs > 0 &&
    policy.deadlineMs <= 30_000 &&
    policy.operatorCooldownSeconds >= 30 &&
    policy.platformPerHour > 0 &&
    policy.platformPerHour <= 60 &&
    policy.leaseSeconds >= policy.deadlineMs / 1000 + 20
  if (!ok) throw new Error(`Integration "${id}" has an unsafe probe policy`)
}

/**
 * Fails startup on a malformed registration. Disabled registrations are validated too, so a
 * module that is switched off cannot hide a broken entry until it is switched on.
 */
export function validateRegistrations(registrations: readonly IntegrationRegistration[]): void {
  if (registrations.length > INTEGRATIONS_MAX) throw new Error('Too many integrations registered')
  const ids = new Set<string>()
  const readers = new Set<unknown>()
  for (const registration of registrations) {
    const { id, name, module, reader, probe } = registration
    if (!ID.test(id)) throw new Error(`Invalid integration id: ${id}`)
    if (ids.has(id)) throw new Error(`Duplicate integration: ${id}`)
    ids.add(id)
    if (name.length < 1 || name.length > 48) throw new Error(`Invalid integration name: ${id}`)
    if (typeof module !== 'function' || typeof reader !== 'function')
      throw new Error(`Incomplete integration: ${id}`)
    if (readers.has(reader)) throw new Error(`Duplicate integration reader: ${id}`)
    readers.add(reader)
    if (probe) {
      if (!ID.test(probe.id)) throw new Error(`Invalid probe id: ${id}`)
      if (!(INTEGRATION_PROBE_KINDS as readonly string[]).includes(probe.kind))
        throw new Error(`Unknown probe kind: ${id}`)
      if (typeof probe.port !== 'function') throw new Error(`Incomplete probe: ${id}`)
      validatePolicy(id, probe.policy)
    }
  }
}
