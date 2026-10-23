import { INTEGRATION_PROBE_KINDS, INTEGRATIONS_MAX } from '@amcore/shared'

import type { IntegrationProbePolicy, IntegrationRegistration } from './integration.types.js'

const ID = /^[a-z][a-z0-9_]{0,31}$/

/**
 * Per-kind ceilings. A registration of an existing kind may be stricter than its kind, never
 * looser, so a registration cannot widen what the reviewed kind allows.
 */
const KIND_ENVELOPE: Record<
  (typeof INTEGRATION_PROBE_KINDS)[number],
  { maxDeadlineMs: number; minCooldownSeconds: number; maxPlatformPerHour: number }
> = {
  operator_email_test: { maxDeadlineMs: 10_000, minCooldownSeconds: 60, maxPlatformPerHour: 20 },
}

const wholeNumber = (value: number): boolean => Number.isFinite(value) && Number.isInteger(value)

function validatePolicy(
  id: string,
  kind: keyof typeof KIND_ENVELOPE,
  policy: IntegrationProbePolicy
): void {
  const envelope = KIND_ENVELOPE[kind]
  const ok =
    [
      policy.deadlineMs,
      policy.operatorCooldownSeconds,
      policy.platformPerHour,
      policy.leaseSeconds,
    ].every(wholeNumber) &&
    policy.deadlineMs > 0 &&
    policy.deadlineMs <= Math.min(30_000, envelope.maxDeadlineMs) &&
    policy.operatorCooldownSeconds >= Math.max(30, envelope.minCooldownSeconds) &&
    policy.platformPerHour > 0 &&
    policy.platformPerHour <= Math.min(60, envelope.maxPlatformPerHour) &&
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
      validatePolicy(id, probe.kind, probe.policy)
    }
  }
}
