/** Backend extension surface, retained when the optional Console frontend is removed. */
export type {
  ControlSnapshot,
  DurableControlState,
  DurableOutcome,
  DurableTransactionContext,
  DurableWorkControl,
  DurableWorkReader,
} from './durable-work'
export type { ManagedJobIdentity, ManagedJobOptions } from './managed-producer'
export { ManagedProducer } from './managed-producer'
export { bindWorkHandlers } from './registration'
export type {
  HandlerBindings,
  JobBinding,
  ReplayPolicy,
  WorkDefinition,
  WorkHandler,
  WorkInvocation,
  WorkPayload,
  WorkRegistration,
} from './work-definition'
export { defineDurableWork, defineOrdinaryWork, defineWork } from './work-definition'
export { resolveWorkFailure, WorkFailure } from './work-failure'
export { WorkReadiness } from './work-readiness'
