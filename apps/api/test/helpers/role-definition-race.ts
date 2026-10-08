import { AuditLogService } from '../../src/core/audit'
import type { AuditLogEntry } from '../../src/core/audit/audit-log.types'
import type { E2ETestContext } from '../helpers'

import { deferred } from './organization-members-race'
const jest = import.meta.jest

/**
 * Deterministic barrier: pause ONE real command inside its transaction, at its strict audit write,
 * i.e. after its row changes and while it still holds the organization lock. Another request started
 * meanwhile can then be proven blocked by the database (`waitForDbBlock`) before the barrier opens.
 */
export function holdAudit(
  context: E2ETestContext,
  match: (entry: AuditLogEntry) => boolean
): { entered: Promise<void>; release: () => void; restore: () => void } {
  const audit = context.app.get(AuditLogService)
  const original = audit.record.bind(audit)
  const entered = deferred()
  const release = deferred()
  let captured = false
  const spy = jest.spyOn(audit, 'record').mockImplementation(async (entry, options) => {
    if (!captured && match(entry)) {
      captured = true
      entered.resolve()
      await release.promise
    }
    return original(entry, options)
  })
  return {
    entered: entered.promise,
    release: release.resolve,
    restore: () => {
      release.resolve()
      spy.mockRestore()
    },
  }
}
