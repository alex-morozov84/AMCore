/** Backend extension surface, retained when the optional Console frontend is removed. */
export type {
  ControlSnapshot,
  DurableControlState,
  DurableOutcome,
  DurableTransactionContext,
  DurableWorkControl,
  DurableWorkReader,
} from './durable-work.js'
export type { ManagedJobIdentity, ManagedJobOptions } from './managed-producer.js'
export { ManagedProducer } from './managed-producer.js'
export { bindWorkHandlers } from './registration.js'
export type {
  HandlerBindings,
  JobBinding,
  ReplayPolicy,
  WorkDefinition,
  WorkHandler,
  WorkInvocation,
  WorkPayload,
  WorkRegistration,
} from './work-definition.js'
export { defineDurableWork, defineOrdinaryWork, defineWork } from './work-definition.js'
export { resolveWorkFailure, WorkFailure } from './work-failure.js'
export { WorkReadiness } from './work-readiness.js'
