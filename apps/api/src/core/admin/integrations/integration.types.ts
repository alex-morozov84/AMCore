import type { Type } from '@nestjs/common'

import type {
  IntegrationAction,
  IntegrationEvidence,
  IntegrationItem,
  ProbePreparation,
  ProbeReceipt,
} from '@amcore/shared'

/** What a reader may say about one integration. The registry validates it before it leaves the API. */
export interface IntegrationReading {
  configuration: IntegrationItem['configuration']
  evidence: IntegrationEvidence
  facts: IntegrationItem['facts']
  links: IntegrationItem['links']
}

/** No side effects and no provider call: a reader reports what is already known. */
export interface IntegrationReader {
  read(signal: AbortSignal): Promise<IntegrationReading>
}

/** Safety policy of an operator-triggered probe. The shared admission layer enforces it. */
export interface IntegrationProbePolicy {
  deadlineMs: number
  operatorCooldownSeconds: number
  platformPerHour: number
  leaseSeconds: number
}

/** The port behind a probe. A registration supplies no recipient, URL, subject, body or command. */
export interface IntegrationProbePort {
  action(actorId: string): Promise<IntegrationAction>
  prepare(actorId: string): Promise<ProbePreparation>
  /** `policy` is the registered one: the port must apply it to its admission and its time budget. */
  run(actorId: string, attemptId: string, policy: IntegrationProbePolicy): Promise<ProbeReceipt>
  receiptFor(actorId: string, attemptId: string): Promise<ProbeReceipt>
}

export interface IntegrationProbeRegistration {
  id: string
  kind: IntegrationAction['kind']
  policy: IntegrationProbePolicy
  port: Type<IntegrationProbePort>
}

export interface IntegrationRegistration {
  /** Stable slug; never reuse an id for a different integration. */
  id: string
  /** English fallback name; the UI uses a message key when one exists for the id. */
  name: string
  /** The module that provides the reader. Imported only when the registration is composed. */
  module: Type<unknown>
  reader: Type<IntegrationReader>
  probe?: IntegrationProbeRegistration
}

export const INTEGRATION_REGISTRATIONS = Symbol('INTEGRATION_REGISTRATIONS')
