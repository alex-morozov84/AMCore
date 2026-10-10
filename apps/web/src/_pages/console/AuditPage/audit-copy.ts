import type { AppConfig } from 'next-intl'

export type AuditCopy = AppConfig['Messages']['console']['audit']

/** New action labels use flat safe keys; historical catalogues remain readable. */
export function auditActionLabel(copy: AuditCopy, action: string): string {
  const labels = copy.actions as Readonly<Record<string, string>>
  return labels[action] ?? labels[action.replaceAll('.', '_')] ?? action
}
