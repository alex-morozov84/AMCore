import { Module } from '@nestjs/common'

import { bindWorkHandlers } from '../background-work/registration.js'
import { PROVIDER_WINDOW_EXECUTION } from '../background-work/work-execution.service.js'

import { EmailModule } from './email.module.js'
import { emailWork } from './email.work.js'
import { QueuedEmailHandler } from './queued-email.handler.js'
import { QueuedEmailExecution } from './queued-email-execution.js'

/**
 * Email worker module (ADR-041).
 *
 * Exports the registration's handler bindings and approved queued-email policy.
 * The shared runtime owns the generated BullMQ host and starts it after readiness.
 * Worker/all roots load this module; web only loads reusable email providers.
 */
@Module({
  imports: [EmailModule],
  providers: [
    QueuedEmailHandler,
    QueuedEmailExecution,
    { provide: PROVIDER_WINDOW_EXECUTION, useExisting: QueuedEmailExecution },
  ],
  exports: [QueuedEmailHandler, PROVIDER_WINDOW_EXECUTION],
})
class QueuedEmailImplementationModule {}

const bindings = bindWorkHandlers(emailWork, { 'send-email@1': QueuedEmailHandler }, [
  QueuedEmailImplementationModule,
])

/** The application registration loads this implementation only for worker/all roles. */
@Module({
  imports: [bindings, QueuedEmailImplementationModule],
  exports: [bindings, QueuedEmailImplementationModule],
})
export class EmailWorkerModule {}
