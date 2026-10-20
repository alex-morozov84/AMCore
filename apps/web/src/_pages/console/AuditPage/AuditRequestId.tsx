import { LogSearchLink } from '@/shared/ui/console-detail/LogSearchLink'

import type { AuditCopy } from './audit-copy'
import { CopyAuditId } from './CopyAuditId'

/**
 * The request ID of an event: a search aid, with copy and a link to the log search. One component for
 * the desktop table and the mobile cards, so the two cannot drift apart.
 */
export function AuditRequestId({ requestId, copy }: { requestId: string; copy: AuditCopy }) {
  return (
    <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
      <p className="flex min-w-0 items-center gap-1">
        <span className="shrink-0">{copy.requestId}:</span>
        <span className="truncate font-console-mono" title={requestId}>
          {requestId}
        </span>
        <CopyAuditId
          id={requestId}
          label={copy.copyId}
          copied={copy.copied}
          failed={copy.copyFailed}
        />
      </p>
      <LogSearchLink id={requestId} className="text-xs" />
    </div>
  )
}
