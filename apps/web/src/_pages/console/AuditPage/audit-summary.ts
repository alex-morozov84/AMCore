import type { AdminAuditResponse } from '@amcore/shared'

import type { AuditCopy } from './audit-copy'

type Item = AdminAuditResponse['items'][number]

export function auditSummary(item: Item, copy: AuditCopy): string | null {
  const values = item.summary
  if (values.beforeRevision !== undefined && values.afterRevision !== undefined)
    return `${copy.summaryInterval}: ${values.beforeIntervalSeconds ?? copy.summaryBaseline} -> ${values.afterIntervalSeconds ?? copy.summaryBaseline} (${values.beforeRevision} -> ${values.afterRevision})`
  if (values.beforeSystemRole || values.afterSystemRole)
    return [
      values.beforeSystemRole && `${copy.summaryBeforeRole}: ${values.beforeSystemRole}`,
      values.afterSystemRole && `${copy.summaryAfterRole}: ${values.afterSystemRole}`,
    ]
      .filter(Boolean)
      .join(' | ')
  if (values.count !== undefined) return `${copy.summaryCount}: ${values.count}`
  const parts = [
    values.decision && `${copy.summaryDecision}: ${values.decision}`,
    values.reasonCode && `${copy.summaryReasonCode}: ${values.reasonCode}`,
    values.outcome && `${copy.summaryOutcome}: ${values.outcome}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' | ') : null
}
