'use client'

import { ConsoleIdentityLookup } from '@/shared/ui/console-detail/ConsoleIdentityLookup'

import type { AuditCopy } from './audit-copy'

export function AuditLookup({
  kind,
  copy,
  onSelect,
}: {
  kind: 'user' | 'organization'
  copy: Pick<AuditCopy, 'lookupUser' | 'lookupOrganization'>
  onSelect: (id: string) => void
}) {
  return (
    <ConsoleIdentityLookup
      inputId={`audit-lookup-${kind}`}
      label={kind === 'user' ? copy.lookupUser : copy.lookupOrganization}
      kind={kind}
      onSelect={onSelect}
    />
  )
}
